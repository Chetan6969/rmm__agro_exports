/**
 * Shipments = lots of an order (proforma invoice). Order planning splits the order's quantity into
 * shipments with planned charges (from the charge-head rate card). Pipeline links (phase 3) live on
 * the shipment row. Company-scoped; RLS applies inside inTenantTx.
 */
import { add, businessDate, isDecimal, isPositive, mul, round, sub } from '@rmm/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables } from '../../db/schema/documents.js';
import { masterTables } from '../../db/schema/masters.js';
import { files } from '../../db/schema/core.js';
import { shipmentCharges, shipments, shipmentStages } from '../../db/schema/shipments.js';
import { lotPipelines, templateFor } from './pipeline.js';
import { orderBuyer } from '../documents/names.js';

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
    .select({ id: pi.id, number: pi.documentNumber, date: pi.documentDate, totalMt: pi.totalQuantityMt, buyer: orderBuyer(), incoterm: pi.incoterm, currency: cur.code })
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
  const pipelines = await lotPipelines(tx, rows);
  return rows.map((r) => {
    const cs = charges.get(r.id as string) ?? [];
    return { ...r, charges: cs, chargeTotal: add(cs.map((c) => str(c.amount)), 2), pipeline: pipelines.get(r.id as string) };
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
  const pipeline = (await lotPipelines(tx, [row])).get(id);
  return { ...row, charges, chargeTotal: add(charges.map((c) => str(c.amount)), 2), pipeline };
}

/**
 * Close, reopen or skip a manual checkpoint of a lot. Closing needs a date (default today), a file
 * when the checkpoint requires proof; skipping needs a reason. Document checkpoints close themselves
 * when the document is linked to the lot.
 */
export async function setStage(tx: Tx, ctx: RequestContext, shipmentId: string, body: unknown) {
  const companyId = requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'edit');
  const p = z
    .object({
      stageKey: z.string().min(1).max(64),
      done: z.boolean(),
      doneDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      fileId: z.uuid().nullable().optional(),
      skipped: z.boolean().optional(),
      skipReason: z.string().trim().max(300).nullable().optional(),
    })
    .parse(body);
  const [ship] = (await tx.select().from(shipments).where(and(eq(shipments.id, shipmentId), isNull(shipments.deletedAt)))) as Row[];
  if (!ship) throw notFound('Shipment not found');
  const step = (await templateFor(tx, str(ship.market))).steps.find((st) => st.key === p.stageKey);
  if (!step) throw badRequest('Unknown checkpoint', 'Reload the page: the checkpoint list may have been changed.');
  if (step.doc) throw badRequest(`"${step.label}" closes automatically`, 'Link the document to this lot (or create it from the lot) instead of ticking it.');
  const skipped = !p.done && !!p.skipped;
  if (skipped && !p.skipReason) throw badRequest('Say why this checkpoint is skipped', { hint: 'The reason is shown on the stage board and kept in the audit log.', fields: { skipReason: 'Required' } });
  if (p.done && step.requiresFile && !p.fileId) {
    throw badRequest(`"${step.label}" needs proof`, { hint: `Attach ${step.evidence ? `the ${step.evidence.toLowerCase()}` : 'a photo or scan'} when ticking it.`, fields: { fileId: 'Required' } });
  }
  if (p.fileId) {
    const [f] = await tx.select({ id: files.id }).from(files).where(eq(files.id, p.fileId));
    if (!f) throw badRequest('The attached file was not found', { hint: 'Upload it again.', fields: { fileId: 'Not found' } });
  }
  const doneDate = p.done ? (p.doneDate ?? businessDate()) : null;
  const values = {
    done: p.done,
    doneDate,
    note: p.note ?? null,
    skipped,
    skipReason: skipped ? (p.skipReason ?? null) : null,
    fileId: p.done ? (p.fileId ?? null) : null,
    doneBy: p.done || skipped ? ctx.userId : null,
  };
  await tx
    .insert(shipmentStages)
    .values({ companyId, shipmentId, stageKey: p.stageKey, ...values })
    .onConflictDoUpdate({ target: [shipmentStages.shipmentId, shipmentStages.stageKey], set: { ...values, updatedAt: new Date() } });
  await audit(tx, ctx, { entity: 'shipments', recordId: shipmentId, action: 'stage', meta: { stage: p.stageKey, done: p.done, skipped, doneDate, skipReason: values.skipReason } });
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

/**
 * Linked documents must exist in this company, not be deleted, and (for the production order and
 * commercial invoice) belong to the shipment's own order (proforma invoice).
 */
async function checkLinks(tx: Tx, p: { proformaInvoiceId: string; productionOrderId?: string | null; commercialInvoiceId?: string | null; oceanBillId?: string | null }) {
  if (!(await piInfo(tx, p.proformaInvoiceId))) throw badRequest('That order (proforma invoice) is not available', { fields: { proformaInvoiceId: 'Not found' } });
  const links = [
    { key: 'productionOrders', id: p.productionOrderId, field: 'productionOrderId', label: 'production order', samePi: true },
    { key: 'commercialInvoices', id: p.commercialInvoiceId, field: 'commercialInvoiceId', label: 'commercial invoice', samePi: true },
    { key: 'oceanBills', id: p.oceanBillId, field: 'oceanBillId', label: 'bill of lading', samePi: false },
  ] as const;
  for (const l of links) {
    if (!l.id) continue;
    const h = docTables[l.key].header;
    const [doc] = (await tx.select().from(h).where(and(eq(h.id, l.id), isNull(h.deletedAt)))) as Row[];
    if (!doc) throw badRequest(`The linked ${l.label} is not available`, { hint: 'It may have been deleted. Pick it again from the list.', fields: { [l.field]: 'Not found' } });
    if (l.samePi && doc.proformaInvoiceId && doc.proformaInvoiceId !== p.proformaInvoiceId) {
      throw badRequest(`${doc.documentNumber} belongs to another order`, { hint: `Link a ${l.label} generated against this order's proforma invoice.`, fields: { [l.field]: 'Other order' } });
    }
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

export async function createShipment(tx: Tx, ctx: RequestContext, body: unknown) {
  const companyId = requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'create');
  const p = shipmentSchema.parse(body);
  await checkLinks(tx, p);
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
  await checkLinks(tx, p);
  const [row] = (await tx.update(shipments).set({ ...shipmentValues(p), updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(shipments.id, id)).returning()) as Row[];
  await writeCharges(tx, companyId, id, p.charges);
  await audit(tx, ctx, { entity: 'shipments', recordId: id, action: 'update', before, after: row });
  return getShipment(tx, ctx, id);
}

/** Link a freshly-created commercial invoice to this lot (and nudge the lot into progress). */
export async function linkInvoice(tx: Tx, ctx: RequestContext, id: string, body: unknown) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'edit');
  const { commercialInvoiceId } = z.object({ commercialInvoiceId: z.uuid() }).parse(body);
  const [ship] = (await tx.select().from(shipments).where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))) as Row[];
  if (!ship) throw notFound('Shipment not found');
  await checkLinks(tx, { proformaInvoiceId: str(ship.proformaInvoiceId), commercialInvoiceId });
  const next = { commercialInvoiceId, status: str(ship.status) === 'PLANNED' ? 'IN_PROGRESS' : str(ship.status), updatedAt: new Date(), updatedBy: ctx.userId };
  await tx.update(shipments).set(next).where(eq(shipments.id, id));
  await audit(tx, ctx, { entity: 'shipments', recordId: id, action: 'update', before: ship, after: { ...ship, ...next } });
  return getShipment(tx, ctx, id);
}

/**
 * Mark the lot shipped/done. The linked commercial invoice (if any) is marked PAID, which is an
 * invoice change: it needs edit rights on commercial invoices and an unlocked, active invoice.
 */
export async function completeShipment(tx: Tx, ctx: RequestContext, id: string) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.shipments', 'edit');
  const [ship] = (await tx.select().from(shipments).where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))) as Row[];
  if (!ship) throw notFound('Shipment not found');
  if (ship.commercialInvoiceId) {
    requirePerm(ctx, 'sales.commercialInvoices', 'edit');
    const ci = docTables.commercialInvoices.header;
    const [inv] = (await tx.select().from(ci).where(and(eq(ci.id, ship.commercialInvoiceId as string), isNull(ci.deletedAt))).for('update')) as Row[];
    if (!inv) throw badRequest('The linked commercial invoice is not available', 'It may have been deleted. Link the right invoice to this lot, then mark it complete.');
    if (inv.locked) throw conflict(`Invoice ${inv.documentNumber} is locked`, 'An administrator must unlock the invoice before the lot can be completed.');
    if (inv.status === 'CANCELLED') throw badRequest(`Invoice ${inv.documentNumber} is cancelled`, 'Link the active invoice for this lot, then mark it complete.');
  }
  await tx.update(shipments).set({ status: 'SHIPPED', updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(shipments.id, id));
  if (ship.commercialInvoiceId) {
    const ci = docTables.commercialInvoices.header;
    await tx
      .update(ci)
      .set({ status: 'PAID', version: sql`${ci.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(ci.id, ship.commercialInvoiceId as string));
  }
  await audit(tx, ctx, { entity: 'shipments', recordId: id, action: 'update', before: ship, after: { ...ship, status: 'SHIPPED' } });
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
      proformaInvoiceId: shipments.proformaInvoiceId,
      piNumber: pi.documentNumber,
      orderSource: pi.orderSource,
      buyer: orderBuyer(),
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
  const charges = await chargesOf(tx, ids);
  const pipelines = await lotPipelines(tx, rows);
  return rows.map((r) => ({
    ...r,
    chargeTotal: add((charges.get(r.id as string) ?? []).map((c) => str(c.amount)), 2),
    pipeline: pipelines.get(r.id as string),
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
  app.post<{ Params: { id: string } }>('/shipments/:id/link-invoice', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => linkInvoice(tx, ctx, req.params.id, req.body));
  });
  app.post<{ Params: { id: string } }>('/shipments/:id/complete', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => completeShipment(tx, ctx, req.params.id));
  });
}
