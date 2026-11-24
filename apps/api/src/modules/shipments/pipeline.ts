/**
 * Shipment checkpoints ("staging"): the company's checkpoint path per market, and each lot's
 * position on it — planned vs actual dates, overdue / due soon, skipped, out of order, proof.
 */
import { businessDate, evaluatePipeline, MARKETS, pipelineSteps, pipelineTemplateSchema, type PipelineStep, type PipelineView, type StageDoc, type StageRecord } from '@rmm/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { audit } from '../../core/audit.js';
import { can, inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables } from '../../db/schema/documents.js';
import { users } from '../../db/schema/core.js';
import { pipelineTemplates, shipmentStages } from '../../db/schema/shipments.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The company's checkpoint path for a market (its own, or the built-in default). */
export async function templateFor(tx: Tx, market: string): Promise<{ steps: PipelineStep[]; custom: boolean; version: number }> {
  const m = market === 'EU' ? 'EU' : 'GULF';
  const [row] = await tx.select().from(pipelineTemplates).where(eq(pipelineTemplates.market, m));
  return row ? { steps: row.steps, custom: true, version: row.version } : { steps: pipelineSteps(m), custom: false, version: 0 };
}

const DOC_SOURCES: { doc: StageDoc; field: string; key: 'proformaInvoices' | 'productionOrders' | 'oceanBills' | 'commercialInvoices'; date: string }[] = [
  { doc: 'pi', field: 'proformaInvoiceId', key: 'proformaInvoices', date: 'documentDate' },
  { doc: 'productionOrder', field: 'productionOrderId', key: 'productionOrders', date: 'documentDate' },
  { doc: 'oceanBill', field: 'oceanBillId', key: 'oceanBills', date: 'documentDate' },
  { doc: 'commercialInvoice', field: 'commercialInvoiceId', key: 'commercialInvoices', date: 'documentDate' },
];

/** Checkpoint view for every given lot (shipment rows), in one pass. */
export async function lotPipelines(tx: Tx, lots: Row[]): Promise<Map<string, PipelineView>> {
  const out = new Map<string, PipelineView>();
  if (!lots.length) return out;
  const ids = lots.map((l) => l.id as string);
  const templates = new Map<string, PipelineStep[]>();
  for (const m of new Set(lots.map((l) => (str(l.market) === 'EU' ? 'EU' : 'GULF')))) templates.set(m, (await templateFor(tx, m)).steps);

  const stageRows = await tx.select().from(shipmentStages).where(inArray(shipmentStages.shipmentId, ids));
  const userIds = [...new Set(stageRows.map((s) => s.doneBy).filter((x): x is string => !!x))];
  const names = new Map(
    userIds.length ? (await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name]) : [],
  );
  // dates of linked documents (they close their checkpoints)
  const docDates = new Map<string, string | null>();
  for (const src of DOC_SOURCES) {
    const linked = [...new Set(lots.map((l) => l[src.field]).filter((x): x is string => typeof x === 'string'))];
    if (!linked.length) continue;
    const h = docTables[src.key].header;
    for (const d of await tx.select({ id: h.id, date: h[src.date], deletedAt: h.deletedAt }).from(h).where(inArray(h.id, linked))) {
      if (!d.deletedAt) docDates.set(d.id as string, (d.date as string) ?? null);
    }
  }
  const today = businessDate();
  for (const lot of lots) {
    const records: Record<string, StageRecord> = {};
    for (const s of stageRows.filter((r) => r.shipmentId === lot.id)) {
      records[s.stageKey] = { done: s.done, doneDate: s.doneDate, note: s.note, skipped: s.skipped, skipReason: s.skipReason, fileId: s.fileId, doneByName: s.doneBy ? (names.get(s.doneBy) ?? null) : null };
    }
    const doneByDoc: Partial<Record<StageDoc, string | null>> = {};
    for (const src of DOC_SOURCES) {
      const id = lot[src.field];
      if (typeof id === 'string' && docDates.has(id)) doneByDoc[src.doc] = docDates.get(id) ?? null;
    }
    out.set(
      lot.id as string,
      evaluatePipeline(templates.get(str(lot.market) === 'EU' ? 'EU' : 'GULF')!, { targetShipDate: (lot.targetShipDate as string) ?? null, doneByDoc, records, today }),
    );
  }
  return out;
}

// ------------------------------------------------------------------ template admin
const canSeeTemplates = (ctx: RequestContext) => can(ctx, 'admin.pipeline', 'view') || can(ctx, 'sales.shipments', 'view');

export async function pipelineRoutes(app: FastifyInstance) {
  app.get('/pipeline/templates', async (req) => {
    const ctx = requireCtx(req);
    requireCompany(ctx);
    if (!canSeeTemplates(ctx)) requirePerm(ctx, 'admin.pipeline', 'view');
    return inTenantTx(ctx, async (tx) => {
      const result: Row = {};
      for (const m of MARKETS) result[m] = { ...(await templateFor(tx, m)), defaults: pipelineSteps(m) };
      return result;
    });
  });

  app.put<{ Params: { market: string }; Body: { steps?: unknown; version?: number } }>('/pipeline/templates/:market', async (req) => {
    const ctx = requireCtx(req);
    const companyId = requireCompany(ctx);
    requirePerm(ctx, 'admin.pipeline', 'edit');
    const market = req.params.market.toUpperCase();
    if (!(MARKETS as readonly string[]).includes(market)) throw badRequest(`Unknown market "${req.params.market}"`, `Use one of: ${MARKETS.join(', ')}.`);
    const steps = pipelineTemplateSchema.parse(req.body?.steps) as PipelineStep[];
    return inTenantTx(ctx, async (tx) => {
      const before = await templateFor(tx, market);
      if (typeof req.body?.version === 'number' && before.version !== req.body.version) {
        throw badRequest('These checkpoints were changed by someone else', 'Reload the page and make your change again.');
      }
      await tx
        .insert(pipelineTemplates)
        .values({ companyId, market, steps, version: 1, updatedBy: ctx.userId })
        .onConflictDoUpdate({ target: [pipelineTemplates.companyId, pipelineTemplates.market], set: { steps, version: before.version + 1, updatedAt: new Date(), updatedBy: ctx.userId } });
      await audit(tx, ctx, { entity: 'pipeline_templates', action: 'update', before: { steps: before.steps }, after: { steps }, meta: { market } });
      return templateFor(tx, market);
    });
  });

  /** Back to the built-in checkpoints for a market. */
  app.delete<{ Params: { market: string } }>('/pipeline/templates/:market', async (req) => {
    const ctx = requireCtx(req);
    requireCompany(ctx);
    requirePerm(ctx, 'admin.pipeline', 'edit');
    const market = req.params.market.toUpperCase();
    return inTenantTx(ctx, async (tx) => {
      await tx.delete(pipelineTemplates).where(and(eq(pipelineTemplates.market, market)));
      await audit(tx, ctx, { entity: 'pipeline_templates', action: 'delete', meta: { market } });
      return templateFor(tx, market);
    });
  });
}
