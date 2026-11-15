import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { companies, sessions, users } from '../db/schema/index.js';
import { isMember, permissionsFor } from './access.js';

export const COOKIE = 'rmm_sid';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    maxAge: config.sessionHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/' });
}

/**
 * onRequest hook: resolve the session cookie into req.ctx.
 * Sessions slide: each request pushes expiry forward (written at most once a minute), and the
 * cookie is re-issued with it so the browser does not drop an active session at login + N hours.
 */
export async function loadSession(req: FastifyRequest, reply: FastifyReply) {
  req.ctx = null;
  const token = req.cookies[COOKIE];
  if (!token) return;
  const now = new Date();
  const [row] = await db()
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      activeCompanyId: sessions.activeCompanyId,
      userId: users.id,
      username: users.username,
      isSuperAdmin: users.isSuperAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(users.isActive, true),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return;

  const newExpiry = new Date(now.getTime() + config.sessionHours * 3600_000);
  if (newExpiry.getTime() - row.expiresAt.getTime() > 60_000) {
    await db().update(sessions).set({ expiresAt: newExpiry }).where(eq(sessions.id, row.sessionId));
    setSessionCookie(reply, token);
  }

  // The company may have been deactivated/deleted, or the membership revoked, while the
  // session was open (super admins included): drop it so nothing is written there.
  let companyId = row.activeCompanyId;
  if (companyId) {
    const [open] = await db()
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.isActive, true), isNull(companies.deletedAt)));
    if (!open || (!row.isSuperAdmin && !(await isMember(db(), row.userId, [companyId])).has(companyId))) {
      companyId = null;
    }
  }

  req.ctx = {
    userId: row.userId,
    sessionId: row.sessionId,
    username: row.username,
    isSuperAdmin: row.isSuperAdmin,
    companyId,
    permissions: row.isSuperAdmin ? new Set() : await permissionsFor(db(), row.userId, companyId),
    ip: req.ip,
  };
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  await db()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : undefined,
      ),
    );
}
