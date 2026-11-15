import { passwordSchema } from '@rmm/shared';
import argon2 from 'argon2';
import { and, asc, eq, inArray, isNull, ne, notExists, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../db/client.js';
import { companies, rolePermissions, roles, userCompanyRoles, users } from '../db/schema/index.js';
import { companiesForUser, permissionsFor } from '../core/access.js';
import { audit } from '../core/audit.js';
import { inTenantTx, requireCtx, requirePerm, type RequestContext } from '../core/context.js';
import { badRequest, conflict, forbidden, notFound } from '../core/errors.js';
import { revokeUserSessions } from '../core/session.js';

const accessSchema = z.array(z.object({ companyId: z.uuid(), roleIds: z.array(z.uuid()) }));

const baseUser = {
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  email: z.preprocess((v) => (v === '' ? null : v), z.email().nullable().optional()),
  phone: z.string().trim().max(30).nullable().optional(),
  isActive: z.boolean().optional(),
  isSuperAdmin: z.boolean().optional(),
  defaultCompanyId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
};

const createSchema = z.object({
  ...baseUser,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3-40 letters, digits, . _ -'),
  password: passwordSchema,
  mustChangePassword: z.boolean().optional(),
  access: accessSchema.optional(),
});

const updateSchema = z.object({ ...baseUser, version: z.number().int() }).strict();

const publicCols = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  isActive: users.isActive,
  isSuperAdmin: users.isSuperAdmin,
  mustChangePassword: users.mustChangePassword,
  defaultCompanyId: users.defaultCompanyId,
  lastLoginAt: users.lastLoginAt,
  version: users.version,
  createdAt: users.createdAt,
};

/** Companies whose user assignments the actor may change. */
async function manageableCompanies(tx: Tx, ctx: RequestContext): Promise<Set<string>> {
  const list = await companiesForUser(tx, ctx.userId, ctx.isSuperAdmin);
  if (ctx.isSuperAdmin) return new Set(list.map((c) => c.id));
  const out = new Set<string>();
  for (const c of list) if ((await permissionsFor(tx, ctx.userId, c.id)).has('admin.users:edit')) out.add(c.id);
  return out;
}

async function loadAccess(tx: Tx, userIds: string[], visibleCompanies: Set<string> | null) {
  if (!userIds.length) return new Map<string, { companyId: string; roleIds: string[] }[]>();
  const rows = await tx
    .select({ userId: userCompanyRoles.userId, companyId: userCompanyRoles.companyId, roleId: userCompanyRoles.roleId })
    .from(userCompanyRoles)
    .where(inArray(userCompanyRoles.userId, userIds));
  const map = new Map<string, { companyId: string; roleIds: string[] }[]>();
  for (const r of rows) {
    if (visibleCompanies && !visibleCompanies.has(r.companyId)) continue;
    const list = map.get(r.userId) ?? [];
    let entry = list.find((e) => e.companyId === r.companyId);
    if (!entry) list.push((entry = { companyId: r.companyId, roleIds: [] }));
    entry.roleIds.push(r.roleId);
    map.set(r.userId, list);
  }
  return map;
}

async function applyAccess(tx: Tx, ctx: RequestContext, userId: string, access: z.infer<typeof accessSchema>) {
  const allowed = await manageableCompanies(tx, ctx);
  for (const a of access) {
    if (!allowed.has(a.companyId)) {
      throw forbidden('You cannot manage users of one of the selected companies', 'Only tick roles in companies where you administer users, or ask a super admin.');
    }
  }
  const roleIds = [...new Set(access.flatMap((a) => a.roleIds))];
  if (roleIds.length) {
    const found = await tx.select({ id: roles.id }).from(roles).where(and(inArray(roles.id, roleIds), isNull(roles.deletedAt)));
    if (found.length !== roleIds.length) throw badRequest('One of the selected roles no longer exists', 'Reload the page and choose the roles again.');
  }
  const before = await loadAccess(tx, [userId], allowed);
  await guardRoleAssignment(tx, ctx, before.get(userId) ?? [], access);
  // Replace assignments only inside companies the actor manages; leave others untouched.
  if (allowed.size) {
    await tx
      .delete(userCompanyRoles)
      .where(and(eq(userCompanyRoles.userId, userId), inArray(userCompanyRoles.companyId, [...allowed])));
  }
  const rows = access.flatMap((a) => [...new Set(a.roleIds)].map((roleId) => ({ userId, companyId: a.companyId, roleId, createdBy: ctx.userId })));
  if (rows.length) await tx.insert(userCompanyRoles).values(rows);
  await audit(tx, ctx, {
    entity: 'users',
    recordId: userId,
    action: 'access_change',
    before: { access: before.get(userId) ?? [] },
    after: { access: access.filter((a) => a.roleIds.length) },
  });
}

/**
 * A non-super admin may only hand out roles whose permissions they hold themselves in that
 * company; otherwise "Users: edit" alone would let anyone assign the Administrator role
 * (to themselves included). Roles the user already had there are left alone.
 */
async function guardRoleAssignment(
  tx: Tx,
  ctx: RequestContext,
  current: { companyId: string; roleIds: string[] }[],
  requested: z.infer<typeof accessSchema>,
) {
  if (ctx.isSuperAdmin) return;
  const held = new Map(current.map((e) => [e.companyId, new Set(e.roleIds)]));
  const added = requested.flatMap((a) =>
    [...new Set(a.roleIds)].filter((roleId) => !held.get(a.companyId)?.has(roleId)).map((roleId) => ({ companyId: a.companyId, roleId })),
  );
  if (!added.length) return;
  const grants = await tx
    .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, [...new Set(added.map((a) => a.roleId))]));
  for (const companyId of new Set(added.map((a) => a.companyId))) {
    const mine = await permissionsFor(tx, ctx.userId, companyId);
    const rolesHere = new Set(added.filter((a) => a.companyId === companyId).map((a) => a.roleId));
    const missing = grants.filter((g) => rolesHere.has(g.roleId) && !mine.has(g.permission)).map((g) => g.permission);
    if (missing.length) {
      throw forbidden(
        `You cannot assign a role with permissions you do not hold: ${[...new Set(missing)].slice(0, 3).join(', ')}`,
        'Pick a role whose permissions you also have in that company, or ask a super admin to assign it.',
      );
    }
  }
}

/**
 * Users a non-super admin may see: members of a company the actor belongs to, plus users the
 * actor created that have no company yet (so they can still be given access).
 */
function visibleUsers(tx: Tx, ctx: RequestContext, myCompanyIds: string[]): SQL | undefined {
  if (ctx.isSuperAdmin) return undefined;
  return or(
    inArray(users.id, tx.select({ id: userCompanyRoles.userId }).from(userCompanyRoles).where(inArray(userCompanyRoles.companyId, myCompanyIds))),
    and(
      eq(users.createdBy, ctx.userId),
      notExists(tx.select({ one: sql`1` }).from(userCompanyRoles).where(eq(userCompanyRoles.userId, users.id))),
    ),
  );
}

async function myCompanyIds(tx: Tx, ctx: RequestContext): Promise<string[]> {
  return (await companiesForUser(tx, ctx.userId, ctx.isSuperAdmin)).map((c) => c.id);
}

async function loadUser(tx: Tx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [u] = await tx.select(publicCols).from(users).where(and(eq(users.id, id), isNull(users.deletedAt)));
  if (!u) throw notFound('User not found', 'The user may have been deleted. Reload the users list.');
  return u;
}

function guardTarget(ctx: RequestContext, target: { id: string; isSuperAdmin: boolean }) {
  if (target.isSuperAdmin && !ctx.isSuperAdmin) throw forbidden('Only a super admin can change a super admin', 'Ask a super admin to make this change.');
}

/**
 * Editing, resetting the password of, or deleting an account is only allowed when every company
 * the account works in is one the actor administers. Otherwise an admin of company A could take
 * over a company B user (reset their password, sign in as them) and read B's data.
 * Accounts with no company yet are manageable by the admin who created them.
 */
async function assertManageable(tx: Tx, ctx: RequestContext, target: { id: string; isSuperAdmin: boolean }) {
  guardTarget(ctx, target);
  if (ctx.isSuperAdmin) return;
  const memberOf = (
    await tx.selectDistinct({ c: userCompanyRoles.companyId }).from(userCompanyRoles).where(eq(userCompanyRoles.userId, target.id))
  ).map((r) => r.c);
  if (!memberOf.length) {
    const [row] = await tx.select({ createdBy: users.createdBy }).from(users).where(eq(users.id, target.id));
    if (row?.createdBy === ctx.userId) return;
    throw forbidden('You can only manage users of the companies you administer', 'Ask the admin who created this user, or a super admin.');
  }
  const allowed = await manageableCompanies(tx, ctx);
  if (memberOf.some((c) => !allowed.has(c))) {
    throw forbidden(
      'This user also works in companies you do not administer',
      'Ask a super admin to make this change, because it would also affect the other companies.',
    );
  }
}

export async function usersRoutes(app: FastifyInstance) {
  app.get('/users', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.users', 'view');
    return inTenantTx(ctx, async (tx) => {
      const mine = await myCompanyIds(tx, ctx);
      const rows = await tx
        .select(publicCols)
        .from(users)
        .where(and(isNull(users.deletedAt), visibleUsers(tx, ctx, mine)))
        .orderBy(asc(users.fullName));
      const visible = ctx.isSuperAdmin ? null : new Set(mine);
      const access = await loadAccess(tx, rows.map((r) => r.id), visible);
      return rows.map((r) => ({ ...r, access: access.get(r.id) ?? [] }));
    });
  });

  app.get<{ Params: { id: string } }>('/users/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.users', 'view');
    return inTenantTx(ctx, async (tx) => {
      const u = await loadUser(tx, req.params.id);
      const mine = await myCompanyIds(tx, ctx);
      const [seen] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, u.id), visibleUsers(tx, ctx, mine)));
      if (!seen) throw notFound('User not found', 'The user may have been deleted or does not work in your companies.');
      const visible = ctx.isSuperAdmin ? null : new Set(mine);
      const access = await loadAccess(tx, [u.id], visible);
      return { ...u, access: access.get(u.id) ?? [] };
    });
  });

  app.post('/users', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.users', 'create');
    const body = createSchema.parse(req.body);
    if (body.isSuperAdmin && !ctx.isSuperAdmin) throw forbidden('Only a super admin can create a super admin', 'Untick Super admin, or ask a super admin to create this user.');
    const created = await inTenantTx(ctx, async (tx) => {
      const [dupe] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.username}) = ${body.username}`, isNull(users.deletedAt)));
      if (dupe) {
        throw conflict('This username is already taken', {
          hint: 'Choose another username, for example add a number or the surname.',
          fields: { username: 'Already exists' },
        });
      }
      const [u] = await tx
        .insert(users)
        .values({
          username: body.username,
          fullName: body.fullName,
          email: body.email ?? null,
          phone: body.phone ?? null,
          isActive: body.isActive ?? true,
          isSuperAdmin: body.isSuperAdmin ?? false,
          mustChangePassword: body.mustChangePassword ?? true,
          defaultCompanyId: body.defaultCompanyId ?? null,
          passwordHash: await argon2.hash(body.password),
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning(publicCols);
      await audit(tx, ctx, { entity: 'users', recordId: u.id, action: 'create', after: u });
      if (body.access?.length) await applyAccess(tx, ctx, u.id, body.access);
      return u;
    });
    return reply.status(201).send(created);
  });

  app.put<{ Params: { id: string } }>('/users/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.users', 'edit');
    const body = updateSchema.parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const before = await loadUser(tx, req.params.id);
      await assertManageable(tx, ctx, before);
      if (body.isSuperAdmin !== undefined && body.isSuperAdmin !== before.isSuperAdmin && !ctx.isSuperAdmin) {
        throw forbidden('Only a super admin can grant super admin', 'Untick Super admin, or ask a super admin.');
      }
      if (before.id === ctx.userId && (body.isActive === false || body.isSuperAdmin === false)) {
        throw badRequest('You cannot deactivate yourself or remove your own super admin rights', 'Ask another super admin to make this change, so the group is never left without one.');
      }
      if (body.defaultCompanyId) {
        const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, body.defaultCompanyId));
        if (!c) throw badRequest('Default company not found', { hint: 'Pick the default company from the list again.', fields: { defaultCompanyId: 'Not found' } });
      }
      const { version, ...values } = body;
      const [u] = await tx
        .update(users)
        .set({ ...values, version: sql`${users.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(and(eq(users.id, before.id), eq(users.version, version)))
        .returning(publicCols);
      if (!u) throw conflict('This user was changed by someone else while you were editing');
      if (body.isActive === false) await revokeUserSessions(u.id);
      await audit(tx, ctx, { entity: 'users', recordId: u.id, action: 'update', before, after: u });
      return u;
    });
  });

  app.put<{ Params: { id: string } }>('/users/:id/access', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.users', 'edit');
    const { access } = z.object({ access: accessSchema }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const target = await loadUser(tx, req.params.id);
      guardTarget(ctx, target);
      await applyAccess(tx, ctx, target.id, access);
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>('/users/:id/reset-password', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.users', 'edit');
    const { password } = z.object({ password: passwordSchema }).parse(req.body);
    await inTenantTx(ctx, async (tx) => {
      const target = await loadUser(tx, req.params.id);
      await assertManageable(tx, ctx, target);
      await tx
        .update(users)
        .set({ passwordHash: await argon2.hash(password), mustChangePassword: true, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(users.id, target.id));
      await audit(tx, ctx, { entity: 'users', recordId: target.id, action: 'reset_password' });
    });
    await revokeUserSessions(req.params.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string }; Body: { reason?: string } }>('/users/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.users', 'delete');
    const reason = req.body?.reason?.trim();
    if (!reason) {
      throw badRequest('A reason is required to delete', {
        hint: 'Type why this user is being deleted; it is kept in the audit log.',
        fields: { reason: 'Required' },
      });
    }
    if (req.params.id === ctx.userId) throw badRequest('You cannot delete yourself', 'Ask another administrator to delete your account.');
    await inTenantTx(ctx, async (tx) => {
      const target = await loadUser(tx, req.params.id);
      await assertManageable(tx, ctx, target);
      if (target.isSuperAdmin) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.isSuperAdmin, true), isNull(users.deletedAt), ne(users.id, target.id)));
        if (n === 0) throw badRequest('Cannot delete the last super admin', 'Make another user a super admin first, then delete this one.');
      }
      await tx
        .update(users)
        .set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason, isActive: false })
        .where(eq(users.id, target.id));
      await tx.delete(userCompanyRoles).where(eq(userCompanyRoles.userId, target.id));
      await audit(tx, ctx, { entity: 'users', recordId: target.id, action: 'delete', meta: { reason } });
    });
    await revokeUserSessions(req.params.id);
    return { ok: true };
  });
}
