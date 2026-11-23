/**
 * Shipments = lots of an order (proforma invoice). Order planning splits the order's quantity into
 * shipments with planned charges (from the charge-head rate card). Pipeline links (phase 3) live on
 * the shipment row. Company-scoped; RLS applies inside inTenantTx.
 */
import { add, isDecimal, isPositive, mul, round, sub } from '@rmm/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables } from '../../db/schema/documents.js';
import { masterTables } from '../../db/schema/masters.js';
import { shipmentCharges, shipments } from '../../db/schema/shipments.js';

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
  const charges = await chargesOf(tx, rows.map((r) => r.id as string));
  return rows.map((r) => {
    const cs = charges.get(r.id as string) ?? [];
    return { ...r, charges: cs, chargeTotal: add(cs.map((c) => str(c.amount)), 2) };
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
  return { ...row, charges, chargeTotal: add(charges.map((c) => str(c.amount)), 2) };
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
});

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
    })
    .from(shipments)
    .leftJoin(pi, eq(pi.id, shipments.proformaInvoiceId))
    .leftJoin(cust, eq(cust.id, pi.buyerId))
    .where(isNull(shipments.deletedAt))
    .orderBy(desc(shipments.targetShipDate), desc(shipments.createdAt))) as Row[];
  return rows;
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
}
