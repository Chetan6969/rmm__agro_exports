import { ALL_PERMISSIONS, passwordSchema, type SessionInfo } from '@rmm/shared';
import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema/index.js';
import { companiesForUser, permissionsFor } from '../core/access.js';
import { audit } from '../core/audit.js';
import { requireCtx, type RequestContext } from '../core/context.js';
import { badRequest, forbidden, unauthorized } from '../core/errors.js';
import { clearSessionCookie, hashToken, newToken, revokeUserSessions, setSessionCookie } from '../core/session.js';

// A fixed hash so unknown usernames cost the same time as wrong passwords.
const DUMMY_HASH = await argon2.hash('timing-equaliser-not-a-password');

export async function sessionInfo(ctx: RequestContext): Promise<SessionInfo> {
  const [u] = await db()
    .select({ id: users.id, username: users.username, fullName: users.fullName, isSuperAdmin: users.isSuperAdmin, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, ctx.userId));
  const list = await companiesForUser(db(), ctx.userId, ctx.isSuperAdmin);
  return {
    user: { id: u.id, username: u.username, fullName: u.fullName, isSuperAdmin: u.isSuperAdmin },
    activeCompany: list.find((c) => c.id === ctx.companyId) ?? null,
    companies: list,
    permissions: ctx.isSuperAdmin ? ALL_PERMISSIONS : [...ctx.permissions],
    mustChangePassword: u.mustChangePassword,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(req.body);
      const [u] = await db()
        .select()
        .from(users)
        .where(and(sql`lower(${users.username}) = lower(${body.username})`, isNull(users.deletedAt)))
        .limit(1);
      const ok = await argon2.verify(u?.passwordHash ?? DUMMY_HASH, body.password);
      if (!u || !ok || !u.isActive) {
        await audit(db(), { userId: u?.id ?? null, companyId: null, ip: req.ip }, {
          entity: 'auth',
          action: 'login_failed',
          meta: { username: body.username },
        }).catch((e) => req.log.warn(e, 'audit failed'));
        throw unauthorized('Invalid username or password');
      }

      const list = await companiesForUser(db(), u.id, u.isSuperAdmin);
      const active = list.find((c) => c.id === u.defaultCompanyId) ?? list[0] ?? null;
      const token = newToken();
      const [s] = await db()
        .insert(sessions)
        .values({
          tokenHash: hashToken(token),
          userId: u.id,
          activeCompanyId: active?.id ?? null,
          ip: req.ip,
          userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
          expiresAt: new Date(Date.now() + config.sessionHours * 3600_000),
        })
        .returning({ id: sessions.id });
      await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
      const ctx: RequestContext = {
        userId: u.id,
        sessionId: s.id,
        username: u.username,
        isSuperAdmin: u.isSuperAdmin,
        companyId: active?.id ?? null,
        permissions: await permissionsFor(db(), u.id, active?.id ?? null),
        ip: req.ip,
      };
      await audit(db(), ctx, { entity: 'auth', action: 'login' });
      setSessionCookie(reply, token);
      return sessionInfo(ctx);
    },
  );

  app.post('/auth/logout', { config: { public: true } }, async (req, reply) => {
    if (req.ctx) {
      await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, req.ctx.sessionId));
      await audit(db(), req.ctx, { entity: 'auth', action: 'logout' });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', async (req) => sessionInfo(requireCtx(req)));

  app.post('/auth/switch-company', async (req) => {
    const ctx = requireCtx(req);
    const { companyId } = z.object({ companyId: z.uuid() }).parse(req.body);
    const list = await companiesForUser(db(), ctx.userId, ctx.isSuperAdmin);
    if (!list.some((c) => c.id === companyId)) throw forbidden('You are not a member of that company');
    await db().update(sessions).set({ activeCompanyId: companyId }).where(eq(sessions.id, ctx.sessionId));
    const next: RequestContext = {
      ...ctx,
      companyId,
      permissions: ctx.isSuperAdmin ? new Set() : await permissionsFor(db(), ctx.userId, companyId),
    };
    await audit(db(), next, { entity: 'auth', action: 'switch_company', meta: { from: ctx.companyId, to: companyId } });
    return sessionInfo(next);
  });

  app.post('/auth/change-password', async (req) => {
    const ctx = requireCtx(req);
    const body = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }).parse(req.body);
    const [u] = await db().select().from(users).where(eq(users.id, ctx.userId));
    if (!(await argon2.verify(u.passwordHash, body.currentPassword))) {
      throw badRequest('Current password is incorrect', { currentPassword: 'Incorrect' });
    }
    if (body.currentPassword === body.newPassword) throw badRequest('New password must differ', { newPassword: 'Must differ' });
    await db()
      .update(users)
      .set({ passwordHash: await argon2.hash(body.newPassword), mustChangePassword: false, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(users.id, ctx.userId));
    await revokeUserSessions(ctx.userId, ctx.sessionId);
    await audit(db(), ctx, { entity: 'users', recordId: ctx.userId, action: 'change_password' });
    return { ok: true };
  });
}
