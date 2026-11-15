import { getEntity } from '@rmm/shared';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { companies, sharingPolicies } from '../db/schema/index.js';
import { companiesForUser } from '../core/access.js';
import { audit } from '../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm } from '../core/context.js';
import { badRequest, conflict, forbidden, notFound } from '../core/errors.js';

const policySchema = z.object({
  entity: z.string().refine((k) => getEntity(k)?.shareable === true, 'This master cannot be shared'),
  /** Super admins may create policies for any source company; others share their active company's data. */
  sourceCompanyId: z.uuid().optional(),
  targetCompanyId: z.uuid(),
  access: z.enum(['read', 'write']).default('read'),
  recordIds: z.array(z.uuid()).min(1).nullable().default(null),
  note: z.string().trim().max(300).nullable().optional(),
});

export async function sharingRoutes(app: FastifyInstance) {
  /** Policies where the active company is the source or the target. Super admins see all. */
  app.get('/sharing', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.sharing', 'view');
    return inTenantTx(ctx, async (tx) => {
      const where = ctx.isSuperAdmin
        ? undefined
        : or(eq(sharingPolicies.sourceCompanyId, requireCompany(ctx)), eq(sharingPolicies.targetCompanyId, requireCompany(ctx)));
      const rows = await tx
        .select({
          policy: sharingPolicies,
          source: sql<string>`(select code from companies c where c.id = ${sharingPolicies.sourceCompanyId})`,
          target: sql<string>`(select code from companies c where c.id = ${sharingPolicies.targetCompanyId})`,
        })
        .from(sharingPolicies)
        .where(where)
        .orderBy(asc(sharingPolicies.entity));
      return rows.map((r) => ({ ...r.policy, sourceCode: r.source, targetCode: r.target }));
    });
  });

  app.post('/sharing', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.sharing', 'create');
    const body = policySchema.parse(req.body);
    const sourceCompanyId = body.sourceCompanyId ?? requireCompany(ctx);
    if (!ctx.isSuperAdmin && sourceCompanyId !== ctx.companyId) {
      throw forbidden('You can only share data of your active company', 'Switch to the company that owns the data (Alt+C) and create the policy there.');
    }
    if (sourceCompanyId === body.targetCompanyId) {
      throw badRequest('A company cannot share with itself', 'Pick a different company to share with.');
    }
    const out = await inTenantTx(ctx, async (tx) => {
      const found = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(or(eq(companies.id, sourceCompanyId), eq(companies.id, body.targetCompanyId)));
      if (found.length !== 2) throw badRequest('Company not found', 'Reload the page and pick the company from the list again.');
      const [dupe] = await tx
        .select({ id: sharingPolicies.id })
        .from(sharingPolicies)
        .where(
          and(
            eq(sharingPolicies.entity, body.entity),
            eq(sharingPolicies.sourceCompanyId, sourceCompanyId),
            eq(sharingPolicies.targetCompanyId, body.targetCompanyId),
          ),
        );
      if (dupe) throw conflict('A policy for this master and these companies already exists', 'Open the existing policy in the list and edit it instead.');
      const [p] = await tx
        .insert(sharingPolicies)
        .values({ ...body, sourceCompanyId, note: body.note ?? null, createdBy: ctx.userId })
        .returning();
      await audit(tx, ctx, { entity: 'sharing_policies', recordId: p.id, action: 'create', after: p });
      return p;
    });
    return reply.status(201).send(out);
  });

  app.put<{ Params: { id: string } }>('/sharing/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.sharing', 'edit');
    const body = policySchema.pick({ access: true, recordIds: true, note: true }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const [before] = await tx.select().from(sharingPolicies).where(eq(sharingPolicies.id, req.params.id));
      if (!before) throw notFound('Policy not found', 'It may have been removed. Reload the list.');
      if (!ctx.isSuperAdmin && before.sourceCompanyId !== ctx.companyId) {
        throw forbidden('Only the owning company can change this policy', 'Switch to the company that shares the data (Alt+C) to change it.');
      }
      const [p] = await tx
        .update(sharingPolicies)
        .set({ access: body.access, recordIds: body.recordIds, note: body.note ?? null, updatedAt: new Date() })
        .where(eq(sharingPolicies.id, before.id))
        .returning();
      await audit(tx, ctx, { entity: 'sharing_policies', recordId: p.id, action: 'update', before, after: p });
      return p;
    });
  });

  app.delete<{ Params: { id: string } }>('/sharing/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.sharing', 'delete');
    return inTenantTx(ctx, async (tx) => {
      const [before] = await tx.select().from(sharingPolicies).where(eq(sharingPolicies.id, req.params.id));
      if (!before) throw notFound('Policy not found', 'It may have been removed. Reload the list.');
      if (!ctx.isSuperAdmin && before.sourceCompanyId !== ctx.companyId) {
        throw forbidden('Only the owning company can remove this policy', 'Switch to the company that shares the data (Alt+C) to remove it.');
      }
      await tx.delete(sharingPolicies).where(eq(sharingPolicies.id, before.id));
      await audit(tx, ctx, { entity: 'sharing_policies', recordId: before.id, action: 'delete', before });
      return { ok: true };
    });
  });

  /** All companies (id/code/name) as share targets — names only, no data. */
  app.get('/sharing/companies', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.sharing', 'view');
    return inTenantTx(ctx, (tx) => companiesForUser(tx, ctx.userId, true));
  });
}
