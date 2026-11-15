import { ALL_PERMISSIONS, isValidPermission, MODULES } from '@rmm/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import { rolePermissions, roles, userCompanyRoles } from '../db/schema/index.js';
import { companiesForUser } from '../core/access.js';
import { audit } from '../core/audit.js';
import { inTenantTx, requireCtx, requirePerm, type RequestContext } from '../core/context.js';
import { badRequest, conflict, forbidden, notFound } from '../core/errors.js';

export const ADMIN_ROLE = 'Administrator';

const roleSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(60),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.string()).refine((ps) => ps.every(isValidPermission), 'Unknown permission in list'),
});

/** Keep the built-in Administrator role holding every permission, including newly added modules. */
export async function syncSystemRoles() {
  await db().transaction(async (tx) => {
    let [admin] = await tx.select().from(roles).where(and(eq(roles.isSystem, true), eq(roles.name, ADMIN_ROLE)));
    if (!admin) {
      [admin] = await tx
        .insert(roles)
        .values({ name: ADMIN_ROLE, description: 'Full access within assigned companies', isSystem: true })
        .returning();
    }
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, admin.id));
    await tx.insert(rolePermissions).values(ALL_PERMISSIONS.map((permission) => ({ roleId: admin.id, permission })));
  });
}

async function withPermissions(tx: Tx, rows: (typeof roles.$inferSelect)[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const perms = await tx.select().from(rolePermissions).where(inArray(rolePermissions.roleId, ids));
  const counts = await tx
    .select({ roleId: userCompanyRoles.roleId, users: sql<number>`count(distinct ${userCompanyRoles.userId})::int` })
    .from(userCompanyRoles)
    .where(inArray(userCompanyRoles.roleId, ids))
    .groupBy(userCompanyRoles.roleId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    version: r.version,
    permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permission),
    userCount: counts.find((c) => c.roleId === r.id)?.users ?? 0,
  }));
}

/** Non-super admins may only hand out permissions they hold themselves, and only edit roles used in their companies. */
async function guardEscalation(tx: Tx, ctx: RequestContext, permissions: string[], roleId?: string) {
  if (ctx.isSuperAdmin) return;
  const missing = permissions.filter((p) => !ctx.permissions.has(p));
  if (missing.length) {
    throw forbidden(
      `You cannot grant permissions you do not have: ${missing.slice(0, 3).join(', ')}`,
      'Untick those permissions, or ask a super admin to make this change.',
    );
  }
  if (roleId) {
    const mine = new Set((await companiesForUser(tx, ctx.userId, false)).map((c) => c.id));
    const used = await tx.selectDistinct({ c: userCompanyRoles.companyId }).from(userCompanyRoles).where(eq(userCompanyRoles.roleId, roleId));
    if (used.some((u) => !mine.has(u.c))) {
      throw forbidden('This role is used in companies you do not manage', 'Create a new role for your company instead, or ask a super admin to change this one.');
    }
  }
}

export async function rolesRoutes(app: FastifyInstance) {
  app.get('/meta/permissions', async (req) => {
    requireCtx(req);
    return MODULES;
  });

  app.get('/roles', async (req) => {
    const ctx = requireCtx(req);
    // Role names are needed to assign users, so users:view also lists them.
    if (!ctx.isSuperAdmin && !ctx.permissions.has('admin.roles:view') && !ctx.permissions.has('admin.users:view')) {
      requirePerm(ctx, 'admin.roles', 'view');
    }
    return inTenantTx(ctx, async (tx) =>
      withPermissions(tx, await tx.select().from(roles).where(isNull(roles.deletedAt)).orderBy(asc(roles.name))),
    );
  });

  app.post('/roles', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.roles', 'create');
    const body = roleSchema.parse(req.body);
    const out = await inTenantTx(ctx, async (tx) => {
      await guardEscalation(tx, ctx, body.permissions);
      const [r] = await tx
        .insert(roles)
        .values({ name: body.name, description: body.description ?? null, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      const perms = [...new Set(body.permissions)];
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((permission) => ({ roleId: r.id, permission })));
      await audit(tx, ctx, { entity: 'roles', recordId: r.id, action: 'create', after: { name: r.name, permissions: perms } });
      return (await withPermissions(tx, [r]))[0];
    });
    return reply.status(201).send(out);
  });

  app.put<{ Params: { id: string } }>('/roles/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.roles', 'edit');
    const body = roleSchema.extend({ version: z.number().int() }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const [before] = await tx.select().from(roles).where(and(eq(roles.id, req.params.id), isNull(roles.deletedAt)));
      if (!before) throw notFound('Role not found', 'It may have been deleted. Reload the roles list.');
      if (before.isSystem) {
        throw badRequest('The Administrator role always has every permission and cannot be edited', 'To give someone fewer rights, create a new role and assign that instead.');
      }
      await guardEscalation(tx, ctx, body.permissions, before.id);
      const [beforeFull] = await withPermissions(tx, [before]);
      const [r] = await tx
        .update(roles)
        .set({ name: body.name, description: body.description ?? null, version: sql`${roles.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(and(eq(roles.id, before.id), eq(roles.version, body.version)))
        .returning();
      if (!r) throw conflict('This role was changed by someone else while you were editing');
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, r.id));
      const perms = [...new Set(body.permissions)];
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((permission) => ({ roleId: r.id, permission })));
      await audit(tx, ctx, {
        entity: 'roles',
        recordId: r.id,
        action: 'update',
        before: { name: beforeFull.name, permissions: beforeFull.permissions.sort() },
        after: { name: r.name, permissions: perms.sort() },
      });
      return (await withPermissions(tx, [r]))[0];
    });
  });

  app.delete<{ Params: { id: string } }>('/roles/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.roles', 'delete');
    return inTenantTx(ctx, async (tx) => {
      const [r] = await tx.select().from(roles).where(and(eq(roles.id, req.params.id), isNull(roles.deletedAt)));
      if (!r) throw notFound('Role not found', 'It may have been deleted. Reload the roles list.');
      if (r.isSystem) throw badRequest('System roles cannot be deleted', 'Remove the role from users instead (Administration → Users).');
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(userCompanyRoles).where(eq(userCompanyRoles.roleId, r.id));
      if (n > 0) {
        throw conflict(`This role is still assigned ${n} time(s)`, 'Open Administration → Users, untick this role for each user, then delete it.');
      }
      await guardEscalation(tx, ctx, [], r.id);
      await tx.update(roles).set({ deletedAt: new Date(), deletedBy: ctx.userId }).where(eq(roles.id, r.id));
      await audit(tx, ctx, { entity: 'roles', recordId: r.id, action: 'delete', meta: { name: r.name } });
      return { ok: true };
    });
  });
}
