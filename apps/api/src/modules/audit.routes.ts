import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, users } from '../db/schema/index.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm } from '../core/context.js';

const q = z.object({
  entity: z.string().optional(),
  recordId: z.string().optional(),
  userId: z.uuid().optional(),
  action: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** super admins: 'all' to include every company and group-level events */
  scope: z.enum(['company', 'all']).default('company'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.audit', 'view');
    const p = q.parse(req.query);
    const conds: SQL[] = [];
    if (!(ctx.isSuperAdmin && p.scope === 'all')) conds.push(eq(auditLogs.companyId, requireCompany(ctx)));
    if (p.entity) conds.push(eq(auditLogs.entity, p.entity));
    if (p.recordId) conds.push(eq(auditLogs.recordId, p.recordId));
    if (p.userId) conds.push(eq(auditLogs.userId, p.userId));
    if (p.action) conds.push(eq(auditLogs.action, p.action));
    if (p.from) conds.push(gte(auditLogs.at, new Date(`${p.from}T00:00:00`)));
    if (p.to) conds.push(lte(auditLogs.at, new Date(`${p.to}T23:59:59.999`)));
    return inTenantTx(ctx, async (tx) => {
      const rows = await tx
        .select({ log: auditLogs, username: users.username, fullName: users.fullName })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(and(...conds))
        .orderBy(desc(auditLogs.at), desc(auditLogs.id))
        .limit(p.pageSize + 1)
        .offset((p.page - 1) * p.pageSize);
      return {
        rows: rows.slice(0, p.pageSize).map((r) => ({ ...r.log, username: r.username, fullName: r.fullName })),
        hasMore: rows.length > p.pageSize,
        page: p.page,
      };
    });
  });
}
