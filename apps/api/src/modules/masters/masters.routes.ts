import { buildEntitySchema, ENTITY_LIST, type EntityDef } from '@rmm/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { entityDefaults } from '../../db/schema/index.js';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm } from '../../core/context.js';
import {
  createRecord,
  deleteRecord,
  exportCsv,
  getRecord,
  listRecords,
  lookup,
  resolveEntity,
  updateRecord,
  type ListQuery,
} from './masters.service.js';

type P = { entity: string; id: string };

export async function mastersRoutes(app: FastifyInstance) {
  /** Registry, so the web app renders forms from the same definitions. */
  app.get('/meta/entities', async (req) => {
    requireCtx(req);
    return ENTITY_LIST;
  });

  app.get<{ Params: P; Querystring: ListQuery }>('/masters/:entity', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => listRecords(tx, ctx, req.params.entity, req.query));
  });

  app.get<{ Params: P; Querystring: ListQuery }>('/masters/:entity/export', async (req, reply) => {
    const ctx = requireCtx(req);
    const { filename, body } = await inTenantTx(ctx, (tx) => exportCsv(tx, ctx, req.params.entity, req.query));
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(body);
  });

  app.get<{ Params: P; Querystring: { q?: string; ids?: string; limit?: number } }>('/masters/:entity/lookup', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => lookup(tx, ctx, req.params.entity, req.query));
  });

  app.get<{ Params: P }>('/masters/:entity/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => getRecord(tx, ctx, req.params.entity, req.params.id));
  });

  app.post<{ Params: P }>('/masters/:entity', async (req, reply) => {
    const ctx = requireCtx(req);
    const row = await inTenantTx(ctx, (tx) => createRecord(tx, ctx, req.params.entity, req.body));
    return reply.status(201).send(row);
  });

  app.put<{ Params: P }>('/masters/:entity/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => updateRecord(tx, ctx, req.params.entity, req.params.id, req.body));
  });

  app.delete<{ Params: P; Body: { reason?: string } }>('/masters/:entity/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => deleteRecord(tx, ctx, req.params.entity, req.params.id, req.body?.reason ?? ''));
  });

  // ---------------------------------------------------------------- per-company form defaults
  app.get<{ Params: P }>('/defaults/:entity', async (req) => {
    const ctx = requireCtx(req);
    const { def } = resolveEntity(req.params.entity);
    const companyId = ctx.companyId;
    const builtIn = Object.fromEntries(def.fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]));
    if (!companyId) return { values: builtIn, configured: {} };
    const [row] = await inTenantTx(ctx, (tx) =>
      tx.select().from(entityDefaults).where(and(eq(entityDefaults.companyId, companyId), eq(entityDefaults.entity, def.key))),
    );
    const configured = row?.values ?? {};
    return { values: { ...builtIn, ...configured }, configured };
  });

  app.put<{ Params: P }>('/defaults/:entity', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.defaults', 'edit');
    const companyId = requireCompany(ctx);
    const { def } = resolveEntity(req.params.entity);
    const allowed = def.fields.filter((f) => !f.unique && f.type !== 'file');
    const schema = buildEntitySchema({ ...def, fields: allowed } as EntityDef, 'update');
    const raw = z.object({ values: z.record(z.string(), z.unknown()) }).parse(req.body).values;
    const parsed = schema.parse(raw) as Record<string, unknown>;
    const values = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && v !== undefined));
    return inTenantTx(ctx, async (tx) => {
      const [before] = await tx
        .select()
        .from(entityDefaults)
        .where(and(eq(entityDefaults.companyId, companyId), eq(entityDefaults.entity, def.key)));
      await tx
        .insert(entityDefaults)
        .values({ companyId, entity: def.key, values, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [entityDefaults.companyId, entityDefaults.entity],
          set: { values, updatedAt: new Date(), updatedBy: ctx.userId },
        });
      await audit(tx, ctx, { entity: 'entity_defaults', recordId: def.key, action: 'update', before: before?.values ?? {}, after: values });
      return { configured: values };
    });
  });
}
