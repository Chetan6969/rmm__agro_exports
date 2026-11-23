/**
 * Shipments = lots of an order (proforma invoice). Order planning splits the order's quantity into
 * shipments with planned charges (from the charge-head rate card). Pipeline links (phase 3) live on
 * the shipment row. Company-scoped; RLS applies inside inTenantTx.
 */
import { add, isDecimal, isPositive, mul, pipelineSteps, round, sub } from '@rmm/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables } from '../../db/schema/documents.js';
import { masterTables } from '../../db/schema/masters.js';
import { shipmentCharges, shipments, shipmentStages } from '../../db/schema/shipments.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const chargeSchema = z.object({
  chargeHeadId: z.uuid().nullable().optional(),
  label: z.string().trim().min(1).max(128),
  qty: z.string().refine((v) => isDecimal(v), 'Enter a valid quantity'),
  rate: z.string().refine((v) => isDecimal(v), 'Enter a valid rate'),
});
const shipmentSchema = z.object({
  proformaInvoiceId: z.uuid(),
  lotNo: z.number().int().min(1),
  market: z.enum(['GULF', 'EU']),
  quantityMt: z.string().refine((v) => isDecimal(v) && isPositive(v), 'Enter a quantity above 0'),
  containerCount: z.number().int().min(0).default(0),
  targetShipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'SHIPPED', 'CANCELLED']).default('PLANNED'),
  notes: z.string().max(1000).nullable().optional(),
  // pipeline document links — setting one auto-completes its step
  productionOrderId: z.uuid().nullable().optional(),
  commercialInvoiceId: z.uuid().nullable().optional(),
  oceanBillId: z.uuid().nullable().optional(),
  charges: z.array(chargeSchema).max(50).default([]),
});

async function piInfo(tx: Tx, piId: string) {
  const pi = docTables.proformaInvoices.header;
  const cust = masterTables.customers;
  const cur = masterTables.currencies;
  const [row] = (await tx
    .select({ id: pi.id, number: pi.documentNumber, date: pi.documentDate, totalMt: pi.totalQuantityMt, buyer: cust.name, incoterm: pi.incoterm, currency: cur.code })
    .from(pi)
    .leftJoin(cust, eq(cust.id, pi.buyerId))
    .leftJoin(cur, eq(cur.id, pi.currencyId))
    .where(and(eq(pi.id, piId), isNull(pi.deletedAt)))) as Row[];
  return row;
}

async function chargesOf(tx: Tx, shipmentIds: string[]): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  if (!shipmentIds.length) return map;
  const rows = (await tx.select().from(shipmentCharges).where(inArray(shipmentCharges.shipmentId, shipmentIds)).orderBy(asc(shipmentCharges.position))) as Row[];
  for (const c of rows) {
    const list = map.get(c.shipmentId as string) ?? [];
    list.push(c);
    map.set(c.shipmentId as string, list);
  }
  return map;
}

async function listForPi(tx: Tx, piId: string): Promise<Row[]> {
  const rows = (await tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.proformaInvoiceId, piId), isNull(shipments.deletedAt)))
    .orderBy(asc(shipments.lotNo))) as Row[];
  const ids = rows.map((r) => r.id as string);
  const charges = await chargesOf(tx, ids);
  const stages = await stagesByShipment(tx, ids);
  return rows.map((r) => {
    const cs = charges.get(r.id as string) ?? [];
    return { ...r, charges: cs, chargeTotal: add(cs.map((c) => str(c.amount)), 2), pipeline: pipelineOf(r, stages.get(r.id as string) ?? []) };
  });
}

export async function planContext(tx: Tx, ctx: RequestContext, piId: string) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'view');
  const pi = await piInfo(tx, piId);
  if (!pi) throw notFound('Proforma invoice not found');
  const list = await listForPi(tx, piId);
  const plannedMt = add(list.filter((s) => s.status !== 'CANCELLED').map((s) => str(s.quantityMt)), 3);
  const ch = masterTables.chargeHeads;
  const chargeHeads = (await tx.select().from(ch).where(and(isNull(ch.deletedAt), eq(ch.isActive, true))).orderBy(asc(ch.name))) as Row[];
  return { pi, shipments: list, plannedMt, remainingMt: sub(str(pi.totalMt), plannedMt, 3), chargeHeads };
}

export async function getShipment(tx: Tx, ctx: RequestContext, id: string) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'view');
  const [row] = (await tx.select().from(shipments).where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))) as Row[];
  if (!row) throw notFound('Shipment not found');
  const charges = (await chargesOf(tx, [id])).get(id) ?? [];
  const stageRows = (await stagesByShipment(tx, [id])).get(id) ?? [];
  return { ...row, charges, chargeTotal: add(charges.map((c) => str(c.amount)), 2), pipeline: pipelineOf(row, stageRows) };
}

/** Tick / untick a manual pipeline step (document-backed steps are driven by the links instead). */
export async function setStage(tx: Tx, ctx: RequestContext, shipmentId: string, body: unknown) {
  const companyId = requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'edit');
  const p = z.object({ stageKey: z.string().min(1).max(64), done: z.boolean(), doneDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().max(500).nullable().optional() }).parse(body);
  const [ship] = (await tx.select().from(shipments).where(and(eq(shipments.id, shipmentId), isNull(shipments.deletedAt)))) as Row[];
  if (!ship) throw notFound('Shipment not found');
  const step = pipelineSteps(str(ship.market)).find((s) => s.key === p.stageKey);
  if (!step) throw badRequest('Unknown pipeline step');
  if (step.doc) throw badRequest('That step completes automatically from its document, not manually');
  const doneDate = p.done ? (p.doneDate ?? new Date().toISOString().slice(0, 10)) : null;
  await tx
    .insert(shipmentStages)
    .values({ companyId, shipmentId, stageKey: p.stageKey, done: p.done, doneDate, note: p.note ?? null })
    .onConflictDoUpdate({ target: [shipmentStages.shipmentId, shipmentStages.stageKey], set: { done: p.done, doneDate, note: p.note ?? null, updatedAt: new Date() } });
  return getShipment(tx, ctx, shipmentId);
}

async function writeCharges(tx: Tx, companyId: string, shipmentId: string, charges: z.infer<typeof chargeSchema>[]) {
  await tx.delete(shipmentCharges).where(eq(shipmentCharges.shipmentId, shipmentId));
  if (charges.length) {
    await tx.insert(shipmentCharges).values(
      charges.map((c, i) => ({ companyId, shipmentId, chargeHeadId: c.chargeHeadId ?? null, label: c.label, qty: c.qty, rate: c.rate, amount: round(mul(c.qty, c.rate, 2), 2), position: i + 1 })),
    );
  }
}

const shipmentValues = (p: z.infer<typeof shipmentSchema>) => ({
  proformaInvoiceId: p.proformaInvoiceId,
  lotNo: p.lotNo,
  market: p.market,
  quantityMt: p.quantityMt,
  containerCount: p.containerCount,
  targetShipDate: p.targetShipDate ?? null,
  status: p.status,
  notes: p.notes ?? null,
  productionOrderId: p.productionOrderId ?? null,
  commercialInvoiceId: p.commercialInvoiceId ?? null,
  oceanBillId: p.oceanBillId ?? null,
});

/** Pipeline for a shipment: document-backed steps derive from the links, the rest from stage rows. */
function pipelineOf(shipment: Row, stageRows: Row[]) {
  const steps = pipelineSteps(str(shipment.market));
  const manual = new Map(stageRows.map((s) => [s.stageKey as string, s]));
  const out = steps.map((st) => {
    let done = false;
    let date: string | null = null;
    let note: string | null = null;
    if (st.doc === 'pi') done = true;
    else if (st.doc === 'productionOrder') done = !!shipment.productionOrderId;
    else if (st.doc === 'oceanBill') done = !!shipment.oceanBillId;
    else if (st.doc === 'commercialInvoice') done = !!shipment.commercialInvoiceId;
    else {
      const m = manual.get(st.key);
      done = !!m?.done;
      date = (m?.doneDate as string) ?? null;
      note = (m?.note as string) ?? null;
    }
    return { key: st.key, label: st.label, doc: st.doc ?? null, done, date, note };
  });
  const doneCount = out.filter((s) => s.done).length;
  return { steps: out, total: out.length, done: doneCount, percent: Math.round((doneCount / out.length) * 100), next: out.find((s) => !s.done)?.label ?? null };
}

async function stagesByShipment(tx: Tx, ids: string[]): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  if (!ids.length) return map;
  const rows = (await tx.select().from(shipmentStages).where(inArray(shipmentStages.shipmentId, ids))) as Row[];
  for (const r of rows) {
    const list = map.get(r.shipmentId as string) ?? [];
    list.push(r);
    map.set(r.shipmentId as string, list);
  }
  return map;
}

export async function createShipment(tx: Tx, ctx: RequestContext, body: unknown) {
  const companyId = requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'create');
  const p = shipmentSchema.parse(body);
  if (!(await piInfo(tx, p.proformaInvoiceId))) throw badRequest('That order (proforma invoice) is not available', { fields: { proformaInvoiceId: 'Not found' } });
  const [row] = (await tx.insert(shipments).values({ ...shipmentValues(p), companyId, createdBy: ctx.userId, updatedBy: ctx.userId }).returning()) as Row[];
  await writeCharges(tx, companyId, row.id as string, p.charges);
  await audit(tx, ctx, { entity: 'shipments', recordId: row.id as string, action: 'create', after: row });
  return getShipment(tx, ctx, row.id as string);
}

export async function updateShipment(tx: Tx, ctx: RequestContext, id: string, body: unknown) {
  const companyId = requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'edit');
  const p = shipmentSchema.parse(body);
  const [before] = (await tx.select().from(shipments).where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))) as Row[];
  if (!before) throw notFound('Shipment not found');
  const [row] = (await tx.update(shipments).set({ ...shipmentValues(p), updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(shipments.id, id)).returning()) as Row[];
  await writeCharges(tx, companyId, id, p.charges);
  await audit(tx, ctx, { entity: 'shipments', recordId: id, action: 'update', before, after: row });
  return getShipment(tx, ctx, id);
}

export async function deleteShipment(tx: Tx, ctx: RequestContext, id: string) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'delete');
  const [before] = (await tx.select().from(shipments).where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))) as Row[];
  if (!before) throw notFound('Shipment not found');
  await tx.update(shipments).set({ deletedAt: new Date(), deletedBy: ctx.userId }).where(eq(shipments.id, id));
  await audit(tx, ctx, { entity: 'shipments', recordId: id, action: 'delete', before });
  return { ok: true };
}

export async function listShipments(tx: Tx, ctx: RequestContext) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'view');
  const pi = docTables.proformaInvoices.header;
  const cust = masterTables.customers;
  const cur = masterTables.currencies;
  const rows = (await tx
    .select({
      id: shipments.id,
      lotNo: shipments.lotNo,
      market: shipments.market,
      quantityMt: shipments.quantityMt,
      containerCount: shipments.containerCount,
      targetShipDate: shipments.targetShipDate,
      status: shipments.status,
      piId: shipments.proformaInvoiceId,
      piNumber: pi.documentNumber,
      buyer: cust.name,
      currency: cur.code,
      productionOrderId: shipments.productionOrderId,
      commercialInvoiceId: shipments.commercialInvoiceId,
      oceanBillId: shipments.oceanBillId,
    })
    .from(shipments)
    .leftJoin(pi, eq(pi.id, shipments.proformaInvoiceId))
    .leftJoin(cust, eq(cust.id, pi.buyerId))
    .leftJoin(cur, eq(cur.id, pi.currencyId))
    .where(isNull(shipments.deletedAt))
    .orderBy(desc(shipments.targetShipDate), desc(shipments.createdAt))) as Row[];
  const ids = rows.map((r) => r.id as string);
  const stages = await stagesByShipment(tx, ids);
  const charges = await chargesOf(tx, ids);
  return rows.map((r) => ({
    ...r,
    chargeTotal: add((charges.get(r.id as string) ?? []).map((c) => str(c.amount)), 2),
    pipeline: pipelineOf(r, stages.get(r.id as string) ?? []),
  }));
}

export async function shipmentsRoutes(app: FastifyInstance) {
  app.get<{ Params: { piId: string } }>('/shipments/plan/:piId', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => planContext(tx, ctx, req.params.piId));
  });
  app.get('/shipments', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => listShipments(tx, ctx));
  });
  app.get<{ Params: { id: string } }>('/shipments/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => getShipment(tx, ctx, req.params.id));
  });
  app.post('/shipments', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => createShipment(tx, ctx, req.body));
  });
  app.put<{ Params: { id: string } }>('/shipments/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => updateShipment(tx, ctx, req.params.id, req.body));
  });
  app.delete<{ Params: { id: string } }>('/shipments/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => deleteShipment(tx, ctx, req.params.id));
  });
  app.post<{ Params: { id: string } }>('/shipments/:id/stage', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => setStage(tx, ctx, req.params.id, req.body));
  });
}
