/**
 * Semi-automatic planning and follow-up of an order:
 *  /planning/:piId            order lines → proposed lots (preview), apply, packaging requirement
 *  /packaging-items/:id       supplier / rate / quantity of one packaging line
 *  /vendor-pos                our purchase orders to packaging suppliers (+ PDF)
 *  /tracker                   every lot with its booking, BL, shipping bill, documents and payment
 *  /shipments/:id/documents   the lot's document checklist; /shipments/:id/tracking its tracking fields
 */
import {
  add,
  BL_STATUSES,
  businessDate,
  checklistFor,
  DEFAULT_PLAN_OPTIONS,
  innerPacks,
  intakeKind,
  isDecimal,
  mul,
  packagingNeeds,
  PACKAGING_COMPONENTS,
  planLots,
  round,
  type PackagingComponent,
  type PlanLineInput,
} from '@rmm/shared';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, ilike } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { companies, docTables, masterTables, packagingItems, payments, shipmentDocuments, shipmentLines, shipments, vendorPos } from '../../db/schema/index.js';
import { allocateNumber } from '../numbering.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dateRx = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ order → plan input

async function orderHeader(tx: Tx, piId: string) {
  const pi = docTables.proformaInvoices.header;
  const cu = masterTables.customers;
  const co = masterTables.countries;
  const [o] = (await tx
    .select({ id: pi.id, number: pi.documentNumber, date: pi.documentDate, status: pi.status, orderSource: pi.orderSource, buyerPoRef: pi.buyerPoRef, lcNumber: pi.lcNumber, totalMt: pi.totalQuantityMt, buyer: cu.name, country: co.name, region: co.region })
    .from(pi)
    .leftJoin(cu, eq(cu.id, pi.buyerId))
    .leftJoin(co, eq(co.id, pi.destinationCountryId))
    .where(and(eq(pi.id, piId), isNull(pi.deletedAt)))) as Row[];
  if (!o) throw notFound('Order not found', 'It may have been deleted, or it belongs to another company.');
  return o;
}

export async function planInput(tx: Tx, piId: string): Promise<PlanLineInput[]> {
  const ln = docTables.proformaInvoices.lines!;
  const pr = masterTables.products;
  const pk = masterTables.packingTypes;
  const po = masterTables.ports;
  const rows = (await tx
    .select({
      id: ln.id,
      product: pr.name,
      brand: ln.brand,
      packingTypeId: ln.packingTypeId,
      packingName: pk.name,
      packingText: ln.packingText,
      netKg: pk.netWeightKg,
      load: sql<string>`coalesce(${ln.containerCapacityMt}, ${pk.containerCapacityMt})`,
      portId: ln.destinationPortId,
      portName: po.name,
      quantityMt: ln.quantityMt,
      dispatchBy: ln.dispatchBy,
    })
    .from(ln)
    .leftJoin(pr, eq(pr.id, ln.productId))
    .leftJoin(pk, eq(pk.id, ln.packingTypeId))
    .leftJoin(po, eq(po.id, ln.destinationPortId))
    .where(eq(ln.documentId, piId))
    .orderBy(asc(ln.position))) as Row[];
  return rows.map((r) => {
    const name = str(r.packingName) || str(r.packingText);
    return {
      lineId: r.id as string,
      label: [str(r.brand) || str(r.product), name].filter(Boolean).join(' · ') || 'Goods',
      packingTypeId: (r.packingTypeId as string) ?? null,
      packingName: name || null,
      packKg: Number(r.netKg ?? 0) || 0,
      innerPacks: innerPacks(name),
      containerLoadMt: Number(r.load ?? 0) || 0,
      portId: (r.portId as string) ?? null,
      portName: (r.portName as string) ?? null,
      quantityMt: Number(r.quantityMt ?? 0),
      dispatchBy: (r.dispatchBy as string) ?? null,
    };
  });
}

async function lotsWithLines(tx: Tx, piId: string) {
  const lots = (await tx.select().from(shipments).where(and(eq(shipments.proformaInvoiceId, piId), isNull(shipments.deletedAt))).orderBy(asc(shipments.lotNo))) as Row[];
  const ids = lots.map((l) => l.id as string);
  const lines = ids.length ? ((await tx.select().from(shipmentLines).where(inArray(shipmentLines.shipmentId, ids)).orderBy(asc(shipmentLines.position))) as Row[]) : [];
  return lots.map((l) => ({ ...l, lines: lines.filter((x) => x.shipmentId === l.id) }) as Row & { lines: Row[] });
}

const optsSchema = z.object({
  maxContainersPerLot: z.number().int().min(1).max(200).default(DEFAULT_PLAN_OPTIONS.maxContainersPerLot),
  defaultContainerLoadMt: z.number().min(1).max(40).default(DEFAULT_PLAN_OPTIONS.defaultContainerLoadMt),
});

// ------------------------------------------------------------------ tracker / checklist helpers

async function received(tx: Tx, ciIds: string[]) {
  if (!ciIds.length) return new Map<string, string>();
  const rows = await tx
    .select({ ci: payments.commercialInvoiceId, amount: sql<string>`coalesce(sum(${payments.amount}), 0)::text` })
    .from(payments)
    .where(and(inArray(payments.commercialInvoiceId, ciIds), isNull(payments.deletedAt)))
    .groupBy(payments.commercialInvoiceId);
  return new Map(rows.map((r) => [r.ci as string, r.amount]));
}

async function checklist(tx: Tx, lot: Row) {
  const docs = await tx.select().from(shipmentDocuments).where(eq(shipmentDocuments.shipmentId, lot.id as string));
  const needed = checklistFor(str(lot.market));
  const keys = [...needed, ...docs.map((d) => d.kind).filter((k) => !needed.includes(k))];
  return keys.map((k) => {
    const d = docs.find((x) => x.kind === k);
    return { kind: k, label: intakeKind(k).label, required: needed.includes(k), status: d?.status ?? 'PENDING', fileId: d?.fileId ?? null, inboxItemId: d?.inboxItemId ?? null, refNo: d?.refNo ?? null, docDate: d?.docDate ?? null, note: d?.note ?? null, updatedAt: d?.updatedAt ?? null };
  });
}

const trackingSchema = z.object({
  shippingLine: z.string().trim().max(80).nullable().optional(),
  bookingNo: z.string().trim().max(60).nullable().optional(),
  vessel: z.string().trim().max(120).nullable().optional(),
  etd: z.string().regex(dateRx).nullable().optional(),
  eta: z.string().regex(dateRx).nullable().optional(),
  invoiceNumber: z.string().trim().max(60).nullable().optional(),
  invoiceAmount: z.string().refine((v) => v === '' || isDecimal(v), 'Enter an amount').nullable().optional(),
  blNumber: z.string().trim().max(60).nullable().optional(),
  blDate: z.string().regex(dateRx).nullable().optional(),
  blStatus: z.enum(BL_STATUSES).optional(),
  sbNumber: z.string().trim().max(40).nullable().optional(),
  sbDate: z.string().regex(dateRx).nullable().optional(),
  leoDate: z.string().regex(dateRx).nullable().optional(),
});

// ------------------------------------------------------------------ vendor PO PDF

async function vendorPoPdf(tx: Tx, poId: string): Promise<{ name: string; body: Buffer }> {
  const [po] = await tx.select().from(vendorPos).where(and(eq(vendorPos.id, poId), isNull(vendorPos.deletedAt)));
  if (!po) throw notFound('Purchase order not found');
  const su = masterTables.suppliers;
  const [s] = (await tx.select().from(su).where(eq(su.id, po.supplierId))) as Row[];
  const [c] = (await tx.select().from(companies).where(eq(companies.id, po.companyId))) as Row[];
  const order = po.proformaInvoiceId ? await orderHeader(tx, po.proformaInvoiceId).catch(() => null) : null;
  const pdf = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Purchase order ${po.number}` } });
  const chunks: Buffer[] = [];
  pdf.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((r) => pdf.on('end', () => r(Buffer.concat(chunks))));
  const L = 40;
  const W = 515;
  pdf.font('Helvetica-Bold').fontSize(14).text(str(c?.legalName) || str(c?.name), L, 40, { width: W, align: 'center' });
  pdf.font('Helvetica').fontSize(8.5).fillColor('#444').text([c?.addressLine1, c?.addressLine2, [c?.city, c?.state, c?.pincode].filter(Boolean).join(', ')].filter(Boolean).join(', '), { width: W, align: 'center' });
  pdf.text([c?.gstin ? `GSTIN ${c.gstin}` : '', c?.phone ? `Phone ${c.phone}` : '', c?.email ? str(c.email) : ''].filter(Boolean).join('   '), { width: W, align: 'center' });
  pdf.moveDown(0.8).fillColor('#000').font('Helvetica-Bold').fontSize(13).text('PURCHASE ORDER', { width: W, align: 'center' });
  const y0 = pdf.y + 10;
  pdf.font('Helvetica-Bold').fontSize(9).text('Supplier', L, y0);
  pdf.font('Helvetica').text([str(s?.name), str(s?.address), [s?.city, s?.state].filter(Boolean).join(', '), s?.gstin ? `GSTIN ${s.gstin}` : '', s?.contactPerson ? `Attn: ${s.contactPerson}` : '', s?.phone ? `Phone ${s.phone}` : ''].filter(Boolean).join('\n'), L, y0 + 12, { width: 260 });
  const kv: [string, string][] = [
    ['PO no.', po.number],
    ['Date', po.poDate],
    ['Delivery by', po.deliveryBy ?? '—'],
    ['Against order', order ? `${str(order.number)}${order.buyerPoRef ? ` (buyer PO ${str(order.buyerPoRef)})` : ''}` : '—'],
  ];
  kv.forEach(([k, v], i) => {
    pdf.font('Helvetica-Bold').text(k, 330, y0 + i * 14, { width: 80 });
    pdf.font('Helvetica').text(v, 410, y0 + i * 14, { width: 145 });
  });
  let y = Math.max(pdf.y, y0 + 70) + 14;
  const cols = [
    { h: '#', w: 22, a: 'left' as const },
    { h: 'Description', w: 263, a: 'left' as const },
    { h: 'Quantity', w: 70, a: 'right' as const },
    { h: 'Unit', w: 40, a: 'left' as const },
    { h: 'Rate (₹)', w: 55, a: 'right' as const },
    { h: 'Amount (₹)', w: 65, a: 'right' as const },
  ];
  const row = (cells: string[], bold = false) => {
    let x = L;
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    const h = Math.max(...cells.map((t, i) => pdf.heightOfString(t, { width: cols[i].w - 6 }))) + 6;
    cells.forEach((t, i) => {
      pdf.text(t, x + 3, y + 3, { width: cols[i].w - 6, align: cols[i].a });
      x += cols[i].w;
    });
    pdf.moveTo(L, y + h).lineTo(L + W, y + h).strokeColor('#bbb').stroke();
    y += h;
  };
  pdf.moveTo(L, y).lineTo(L + W, y).strokeColor('#888').stroke();
  row(cols.map((c) => c.h), true);
  po.lines.forEach((l, i) => row([String(i + 1), l.description, l.quantity.toLocaleString('en-IN'), l.unit, l.rate ? Number(l.rate).toLocaleString('en-IN') : '—', l.amount ? Number(l.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—']));
  row(['', 'Total', '', '', '', Number(po.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })], true);
  if (po.notes) {
    pdf.font('Helvetica').fontSize(9).text(po.notes, L, y + 12, { width: W });
    y = pdf.y;
  }
  pdf.font('Helvetica-Bold').fontSize(9).text(`for ${str(c?.legalName) || str(c?.name)}`, 330, y + 40, { width: 225, align: 'right' });
  pdf.font('Helvetica').text('Authorised signatory', 330, y + 80, { width: 225, align: 'right' });
  pdf.end();
  return { name: `PO_${po.number.replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`, body: await done };
}

// ------------------------------------------------------------------ routes

export async function planningRoutes(app: FastifyInstance) {
  app.get<{ Params: { piId: string } }>('/planning/:piId', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.shipments', 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const order = await orderHeader(tx, req.params.piId);
      const input = await planInput(tx, req.params.piId);
      const lots = await lotsWithLines(tx, req.params.piId);
      const items = await tx.select().from(packagingItems).where(eq(packagingItems.proformaInvoiceId, req.params.piId)).orderBy(asc(packagingItems.position));
      const pos = await tx.select().from(vendorPos).where(and(eq(vendorPos.proformaInvoiceId, req.params.piId), isNull(vendorPos.deletedAt))).orderBy(desc(vendorPos.poDate));
      const su = masterTables.suppliers;
      const supplierIds = [...new Set([...items.map((i) => i.supplierId), ...pos.map((p) => p.supplierId)].filter(Boolean) as string[])];
      const suppliers = supplierIds.length ? ((await tx.select({ id: su.id, name: su.name }).from(su).where(inArray(su.id, supplierIds))) as { id: string; name: string }[]) : [];
      const name = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? null;
      return {
        order,
        input,
        options: DEFAULT_PLAN_OPTIONS,
        suggestedMarket: str(order.region).toLowerCase().includes('europe') ? 'EU' : 'GULF',
        lots,
        packaging: items.map((i) => ({ ...i, supplierName: name(i.supplierId) })),
        vendorPos: pos.map((p) => ({ ...p, supplierName: name(p.supplierId) })),
        components: PACKAGING_COMPONENTS.map((c) => ({ key: c.key, label: c.label })),
      };
    });
  });

  app.post<{ Params: { piId: string } }>('/planning/:piId/preview', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.shipments', 'view');
    requireCompany(ctx);
    const opts = optsSchema.parse(req.body ?? {});
    return inTenantTx(ctx, async (tx) => {
      await orderHeader(tx, req.params.piId);
      const input = await planInput(tx, req.params.piId);
      return { lots: planLots(input, opts), warnings: warningsFor(input) };
    });
  });

  /** Create the proposed lots (with their lines). Replacing is allowed only while no lot has started. */
  app.post<{ Params: { piId: string } }>('/planning/:piId/apply', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.shipments', 'create');
    const companyId = requireCompany(ctx);
    const body = optsSchema.extend({ market: z.enum(['GULF', 'EU']), replace: z.boolean().default(false) }).parse(req.body ?? {});
    return inTenantTx(ctx, async (tx) => {
      const order = await orderHeader(tx, req.params.piId);
      if (order.status === 'CANCELLED') throw badRequest('This order is cancelled');
      const input = await planInput(tx, req.params.piId);
      if (!input.some((l) => l.quantityMt > 0)) throw badRequest('The order has no quantities to plan', 'Add the order lines (quantity, packing, port, dispatch date) first.');
      const lots = planLots(input, body);
      const existing = (await tx.select().from(shipments).where(and(eq(shipments.proformaInvoiceId, req.params.piId), isNull(shipments.deletedAt), ne(shipments.status, 'CANCELLED')))) as Row[];
      if (existing.length && !body.replace) throw conflict(`This order already has ${existing.length} lot(s)`, 'Tick "Replace the planned lots" to plan again, or edit the lots by hand.');
      const started = existing.filter((s) => s.status !== 'PLANNED' || s.productionOrderId || s.commercialInvoiceId || s.oceanBillId || s.blNumber || s.invoiceNumber);
      if (started.length) throw conflict(`Lot ${started.map((s) => s.lotNo).join(', ')} has already started`, 'Lots with a production order, invoice or BL are kept; replan only the order lines not yet shipped by hand.');
      if (existing.length) {
        await tx.update(shipments).set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: 'Replaced by automatic planning' }).where(inArray(shipments.id, existing.map((s) => s.id as string)));
      }
      const [{ maxLot }] = await tx.select({ maxLot: sql<number>`coalesce(max(${shipments.lotNo}), 0)::int` }).from(shipments).where(eq(shipments.proformaInvoiceId, req.params.piId));
      const created: string[] = [];
      for (const lot of lots) {
        const [s] = await tx
          .insert(shipments)
          .values({ companyId, proformaInvoiceId: req.params.piId, lotNo: maxLot + lot.lotNo, market: body.market, quantityMt: String(lot.quantityMt), containerCount: lot.containers, targetShipDate: lot.targetShipDate, status: 'PLANNED', period: lot.period, createdBy: ctx.userId, updatedBy: ctx.userId })
          .returning({ id: shipments.id });
        created.push(s.id);
        await tx.insert(shipmentLines).values(
          lot.lines.map((l, i) => ({ companyId, shipmentId: s.id, orderLineId: l.lineId, label: l.label, packingTypeId: l.packingTypeId, packingName: l.packingName, packKg: String(l.packKg), innerPacks: l.innerPacks, portId: l.portId, portName: l.portName, quantityMt: String(l.quantityMt), bags: l.bags, containers: l.containers, position: i })),
        );
      }
      await audit(tx, ctx, { entity: 'shipments', recordId: req.params.piId, action: 'auto-plan', meta: { lots: lots.length, replaced: existing.length, maxContainersPerLot: body.maxContainersPerLot } });
      return { created: created.length, lots: await lotsWithLines(tx, req.params.piId) };
    });
  });

  /** Work out the packaging to buy from the planned lots (keeps chosen suppliers and rates). */
  app.post<{ Params: { piId: string } }>('/planning/:piId/packaging', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'create');
    const companyId = requireCompany(ctx);
    const body = z.object({ freePct: z.number().min(0).max(50).default(2), components: z.array(z.enum(PACKAGING_COMPONENTS.map((c) => c.key) as [PackagingComponent, ...PackagingComponent[]])).min(1).default(['outer', 'inner', 'tag', 'strip', 'seal']) }).parse(req.body ?? {});
    return inTenantTx(ctx, async (tx) => {
      await orderHeader(tx, req.params.piId);
      const lots = await lotsWithLines(tx, req.params.piId);
      const lines = lots.filter((l) => l.status !== 'CANCELLED').flatMap((l) => l.lines);
      if (!lines.length) throw badRequest('Plan the lots first', 'Packaging is worked out from the bags in the planned lots.');
      const needs = packagingNeeds(
        lines.map((l) => ({ packingTypeId: (l.packingTypeId as string) ?? null, packingName: (l.packingName as string) ?? str(l.label), bags: Number(l.bags), innerPacks: Number(l.innerPacks) })),
        body.freePct,
        body.components,
      );
      const old = await tx.select().from(packagingItems).where(eq(packagingItems.proformaInvoiceId, req.params.piId));
      const keyOf = (x: { component: string; packingName: string }) => `${x.component}|${x.packingName}`;
      const ordered = new Map<string, number>();
      for (const o of old.filter((x) => x.status === 'ORDERED')) ordered.set(keyOf(o), (ordered.get(keyOf(o)) ?? 0) + o.quantity);
      const prev = new Map(old.filter((x) => x.status === 'TO_ORDER').map((x) => [keyOf(x), x]));
      await tx.delete(packagingItems).where(and(eq(packagingItems.proformaInvoiceId, req.params.piId), eq(packagingItems.status, 'TO_ORDER')));
      let pos = old.length;
      for (const n of needs) {
        const qty = n.quantity - (ordered.get(keyOf(n)) ?? 0);
        if (qty <= 0) continue;
        const p = prev.get(keyOf(n));
        await tx.insert(packagingItems).values({ companyId, proformaInvoiceId: req.params.piId, component: n.component, label: n.label, packingTypeId: n.packingTypeId, packingName: n.packingName, bags: n.bags, perBag: String(n.perBag), freePct: String(n.freePct), quantity: qty, supplierId: p?.supplierId ?? null, rate: p?.rate ?? null, status: 'TO_ORDER', position: pos++ });
      }
      await audit(tx, ctx, { entity: 'packaging', recordId: req.params.piId, action: 'calculate', meta: { freePct: body.freePct, items: needs.length } });
      return tx.select().from(packagingItems).where(eq(packagingItems.proformaInvoiceId, req.params.piId)).orderBy(asc(packagingItems.position));
    });
  });

  app.put<{ Params: { id: string } }>('/packaging-items/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'edit');
    requireCompany(ctx);
    const body = z.object({ supplierId: z.uuid().nullable().optional(), rate: z.string().refine((v) => v === '' || isDecimal(v), 'Enter a rate').nullable().optional(), quantity: z.number().int().min(0).optional() }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const [it] = await tx.select().from(packagingItems).where(eq(packagingItems.id, req.params.id));
      if (!it) throw notFound('Packaging line not found');
      if (it.status === 'ORDERED') throw conflict('This line is already on a purchase order', 'Change the purchase order instead.');
      const [row] = await tx
        .update(packagingItems)
        .set({ supplierId: body.supplierId === undefined ? it.supplierId : body.supplierId, rate: body.rate === undefined ? it.rate : body.rate || null, quantity: body.quantity ?? it.quantity, updatedAt: new Date() })
        .where(eq(packagingItems.id, it.id))
        .returning();
      return row;
    });
  });

  /** One draft purchase order per supplier, from the packaging lines that have a supplier. */
  app.post<{ Params: { piId: string } }>('/planning/:piId/vendor-pos', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'create');
    const companyId = requireCompany(ctx);
    const body = z.object({ deliveryBy: z.string().regex(dateRx).nullable().optional(), itemIds: z.array(z.uuid()).optional() }).parse(req.body ?? {});
    return inTenantTx(ctx, async (tx) => {
      const order = await orderHeader(tx, req.params.piId);
      const conds = [eq(packagingItems.proformaInvoiceId, req.params.piId), eq(packagingItems.status, 'TO_ORDER')];
      if (body.itemIds?.length) conds.push(inArray(packagingItems.id, body.itemIds));
      const items = await tx.select().from(packagingItems).where(and(...conds)).orderBy(asc(packagingItems.position));
      const withSupplier = items.filter((i) => i.supplierId && i.quantity > 0);
      if (!withSupplier.length) throw badRequest('Choose a supplier for the packaging lines first', 'Pick the supplier (and rate) on each line, then create the purchase orders.');
      const bySupplier = new Map<string, typeof withSupplier>();
      for (const i of withSupplier) bySupplier.set(i.supplierId!, [...(bySupplier.get(i.supplierId!) ?? []), i]);
      const made: string[] = [];
      const today = businessDate();
      for (const [supplierId, list] of bySupplier) {
        const lines = list.map((i) => {
          const amount = i.rate ? round(mul(String(i.quantity), i.rate, 2), 2) : '0';
          return { description: `${i.label} for ${i.packingName}${Number(i.freePct) ? ` (incl. ${Number(i.freePct)}% spare)` : ''}`, quantity: i.quantity, unit: 'Nos', rate: i.rate ?? '', amount };
        });
        const number = await allocateNumber(tx, ctx, 'purchase_order', today);
        const [po] = await tx
          .insert(vendorPos)
          .values({ companyId, number, poDate: today, supplierId, proformaInvoiceId: req.params.piId, status: 'DRAFT', deliveryBy: body.deliveryBy ?? null, lines, totalAmount: add(lines.map((l) => l.amount), 2), notes: `For order ${str(order.number)}${order.buyerPoRef ? ` / buyer PO ${str(order.buyerPoRef)}` : ''}.`, createdBy: ctx.userId, updatedBy: ctx.userId })
          .returning({ id: vendorPos.id });
        await tx.update(packagingItems).set({ status: 'ORDERED', vendorPoId: po.id, updatedAt: new Date() }).where(inArray(packagingItems.id, list.map((i) => i.id)));
        await audit(tx, ctx, { entity: 'vendorPos', recordId: po.id, action: 'create', meta: { number, supplierId, lines: lines.length } });
        made.push(po.id);
      }
      return { created: made };
    });
  });

  app.get<{ Querystring: { orderId?: string; status?: string; search?: string } }>('/vendor-pos', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const su = masterTables.suppliers;
      const pi = docTables.proformaInvoices.header;
      const conds = [isNull(vendorPos.deletedAt)];
      if (req.query.orderId) conds.push(eq(vendorPos.proformaInvoiceId, req.query.orderId));
      if (req.query.status) conds.push(eq(vendorPos.status, req.query.status));
      if (req.query.search?.trim()) conds.push(or(ilike(vendorPos.number, `%${req.query.search.trim()}%`), ilike(su.name, `%${req.query.search.trim()}%`))!);
      return tx
        .select({ id: vendorPos.id, number: vendorPos.number, poDate: vendorPos.poDate, status: vendorPos.status, deliveryBy: vendorPos.deliveryBy, totalAmount: vendorPos.totalAmount, lines: vendorPos.lines, supplierName: su.name, orderId: vendorPos.proformaInvoiceId, orderNumber: pi.documentNumber })
        .from(vendorPos)
        .leftJoin(su, eq(su.id, vendorPos.supplierId))
        .leftJoin(pi, eq(pi.id, vendorPos.proformaInvoiceId))
        .where(and(...conds))
        .orderBy(desc(vendorPos.poDate), desc(vendorPos.number))
        .limit(300);
    });
  });

  app.put<{ Params: { id: string } }>('/vendor-pos/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'edit');
    requireCompany(ctx);
    const body = z
      .object({
        status: z.enum(['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED']).optional(),
        deliveryBy: z.string().regex(dateRx).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        lines: z.array(z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().int().min(0), unit: z.string().trim().max(12), rate: z.string().refine((v) => v === '' || isDecimal(v)) })).min(1).max(60).optional(),
      })
      .parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const [before] = await tx.select().from(vendorPos).where(and(eq(vendorPos.id, req.params.id), isNull(vendorPos.deletedAt)));
      if (!before) throw notFound('Purchase order not found');
      const lines = body.lines?.map((l) => ({ ...l, amount: l.rate ? round(mul(String(l.quantity), l.rate, 2), 2) : '0' }));
      const [after] = await tx
        .update(vendorPos)
        .set({ status: body.status ?? before.status, deliveryBy: body.deliveryBy === undefined ? before.deliveryBy : body.deliveryBy, notes: body.notes === undefined ? before.notes : body.notes, ...(lines ? { lines, totalAmount: add(lines.map((l) => l.amount), 2) } : {}), version: sql`${vendorPos.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(vendorPos.id, before.id))
        .returning();
      // a cancelled PO frees its packaging lines to be ordered again
      if (body.status === 'CANCELLED' && before.status !== 'CANCELLED') await tx.update(packagingItems).set({ status: 'TO_ORDER', vendorPoId: null, updatedAt: new Date() }).where(eq(packagingItems.vendorPoId, before.id));
      await audit(tx, ctx, { entity: 'vendorPos', recordId: before.id, action: 'update', before, after });
      return after;
    });
  });

  app.delete<{ Params: { id: string } }>('/vendor-pos/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'delete');
    requireCompany(ctx);
    const reason = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {}).reason ?? null;
    return inTenantTx(ctx, async (tx) => {
      const [po] = await tx.select().from(vendorPos).where(and(eq(vendorPos.id, req.params.id), isNull(vendorPos.deletedAt)));
      if (!po) throw notFound('Purchase order not found');
      await tx.update(vendorPos).set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason }).where(eq(vendorPos.id, po.id));
      await tx.update(packagingItems).set({ status: 'TO_ORDER', vendorPoId: null, updatedAt: new Date() }).where(eq(packagingItems.vendorPoId, po.id));
      await audit(tx, ctx, { entity: 'vendorPos', recordId: po.id, action: 'delete', meta: { number: po.number, reason } });
      return { ok: true };
    });
  });

  app.get<{ Params: { id: string } }>('/vendor-pos/:id/pdf', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'print');
    requireCompany(ctx);
    const out = await inTenantTx(ctx, async (tx) => {
      const r = await vendorPoPdf(tx, req.params.id);
      await tx.update(vendorPos).set({ printed: true }).where(eq(vendorPos.id, req.params.id));
      return r;
    });
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${out.name}"`).send(out.body);
  });

  // ---------------------------------------------------------------- tracker

  app.get<{ Querystring: { status?: string; search?: string; market?: string } }>('/tracker', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.shipments', 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const pi = docTables.proformaInvoices.header;
      const cu = masterTables.customers;
      const conds = [isNull(shipments.deletedAt), isNull(pi.deletedAt)];
      if (req.query.status === 'open' || !req.query.status) conds.push(sql`${shipments.status} not in ('SHIPPED','CANCELLED') or ${shipments.blStatus} not in ('RECEIVED','RELEASED')`);
      else if (req.query.status !== 'all') conds.push(eq(shipments.status, req.query.status));
      if (req.query.market) conds.push(eq(shipments.market, req.query.market));
      if (req.query.search?.trim()) {
        const s = `%${req.query.search.trim()}%`;
        conds.push(or(ilike(pi.documentNumber, s), ilike(pi.buyerPoRef, s), ilike(cu.name, s), ilike(shipments.invoiceNumber, s), ilike(shipments.blNumber, s), ilike(shipments.bookingNo, s), ilike(shipments.vessel, s))!);
      }
      const rows = (await tx
        .select({
          id: shipments.id,
          lotNo: shipments.lotNo,
          market: shipments.market,
          status: shipments.status,
          period: shipments.period,
          quantityMt: shipments.quantityMt,
          containerCount: shipments.containerCount,
          targetShipDate: shipments.targetShipDate,
          shippingLine: shipments.shippingLine,
          bookingNo: shipments.bookingNo,
          vessel: shipments.vessel,
          etd: shipments.etd,
          eta: shipments.eta,
          invoiceNumber: shipments.invoiceNumber,
          invoiceAmount: shipments.invoiceAmount,
          blNumber: shipments.blNumber,
          blDate: shipments.blDate,
          blStatus: shipments.blStatus,
          sbNumber: shipments.sbNumber,
          leoDate: shipments.leoDate,
          commercialInvoiceId: shipments.commercialInvoiceId,
          orderId: pi.id,
          orderNumber: pi.documentNumber,
          buyerPoRef: pi.buyerPoRef,
          lcNumber: pi.lcNumber,
          orderSource: pi.orderSource,
          buyer: cu.name,
        })
        .from(shipments)
        .innerJoin(pi, eq(pi.id, shipments.proformaInvoiceId))
        .leftJoin(cu, eq(cu.id, pi.buyerId))
        .where(and(...conds))
        .orderBy(asc(sql`coalesce(${shipments.targetShipDate}, '9999-12-31')`), asc(pi.documentNumber), asc(shipments.lotNo))
        .limit(500)) as Row[];
      const ids = rows.map((r) => r.id as string);
      const docs = ids.length ? await tx.select({ shipmentId: shipmentDocuments.shipmentId, kind: shipmentDocuments.kind, status: shipmentDocuments.status }).from(shipmentDocuments).where(inArray(shipmentDocuments.shipmentId, ids)) : [];
      const paid = await received(tx, rows.map((r) => r.commercialInvoiceId as string).filter(Boolean));
      const today = businessDate();
      return rows.map((r) => {
        const need = checklistFor(str(r.market));
        const mine = docs.filter((d) => d.shipmentId === r.id);
        const done = need.filter((k) => mine.some((d) => d.kind === k && (d.status === 'RECEIVED' || d.status === 'NOT_NEEDED'))).length;
        const rec = r.commercialInvoiceId ? (paid.get(r.commercialInvoiceId as string) ?? '0') : '0';
        const amount = Number(r.invoiceAmount ?? 0);
        const payment = Number(rec) <= 0 ? 'PENDING' : amount && Number(rec) + 0.5 < amount ? 'PART' : 'RECEIVED';
        const alerts: string[] = [];
        if (r.targetShipDate && str(r.targetShipDate) < today && r.status === 'PLANNED') alerts.push('Ship date passed');
        if (r.eta && str(r.eta) < today && !['RECEIVED', 'RELEASED'].includes(str(r.blStatus))) alerts.push('Vessel arrived, BL not received');
        if (r.leoDate && !r.blNumber) alerts.push('LEO done, BL missing');
        if (r.status === 'SHIPPED' && done < need.length) alerts.push(`${need.length - done} document(s) missing`);
        return { ...r, docsDone: done, docsNeeded: need.length, received: rec, payment, alerts };
      });
    });
  });

  app.get<{ Params: { id: string } }>('/shipments/:id/documents', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.shipments', 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const [lot] = (await tx.select().from(shipments).where(and(eq(shipments.id, req.params.id), isNull(shipments.deletedAt)))) as Row[];
      if (!lot) throw notFound('Shipment lot not found');
      const lines = await tx.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, req.params.id)).orderBy(asc(shipmentLines.position));
      return { lot, lines, checklist: await checklist(tx, lot) };
    });
  });

  app.put<{ Params: { id: string; kind: string } }>('/shipments/:id/documents/:kind', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.shipments', 'edit');
    const companyId = requireCompany(ctx);
    const body = z
      .object({ status: z.enum(['RECEIVED', 'NOT_NEEDED', 'PENDING']), fileId: z.uuid().nullable().optional(), refNo: z.string().trim().max(80).nullable().optional(), docDate: z.string().regex(dateRx).nullable().optional(), note: z.string().max(500).nullable().optional() })
      .parse(req.body);
    const kind = intakeKind(req.params.kind).key;
    return inTenantTx(ctx, async (tx) => {
      const [lot] = (await tx.select().from(shipments).where(and(eq(shipments.id, req.params.id), isNull(shipments.deletedAt)))) as Row[];
      if (!lot) throw notFound('Shipment lot not found');
      if (body.status === 'PENDING') await tx.delete(shipmentDocuments).where(and(eq(shipmentDocuments.shipmentId, req.params.id), eq(shipmentDocuments.kind, kind)));
      else {
        const values = { status: body.status, fileId: body.fileId ?? null, refNo: body.refNo ?? null, docDate: body.docDate ?? null, note: body.note ?? null, updatedBy: ctx.userId };
        await tx
          .insert(shipmentDocuments)
          .values({ companyId, shipmentId: req.params.id, kind, ...values })
          .onConflictDoUpdate({ target: [shipmentDocuments.shipmentId, shipmentDocuments.kind], set: { ...values, updatedAt: new Date() } });
      }
      await audit(tx, ctx, { entity: 'shipments', recordId: req.params.id, action: 'document', meta: { kind, status: body.status, refNo: body.refNo } });
      return checklist(tx, lot);
    });
  });

  app.put<{ Params: { id: string } }>('/shipments/:id/tracking', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.shipments', 'edit');
    requireCompany(ctx);
    const body = trackingSchema.parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const [before] = (await tx.select().from(shipments).where(and(eq(shipments.id, req.params.id), isNull(shipments.deletedAt)))) as Row[];
      if (!before) throw notFound('Shipment lot not found');
      const set = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));
      const [after] = (await tx
        .update(shipments)
        .set({ ...set, version: sql`${shipments.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(shipments.id, req.params.id))
        .returning()) as Row[];
      await audit(tx, ctx, { entity: 'shipments', recordId: req.params.id, action: 'tracking', before, after });
      return after;
    });
  });
}

/** Things that make the automatic plan less reliable, shown above the preview. */
function warningsFor(input: PlanLineInput[]) {
  const w: string[] = [];
  if (input.some((l) => !l.packKg)) w.push('Some order lines have no packing (or the packing has no net weight): bags cannot be counted for them.');
  if (input.some((l) => !l.containerLoadMt)) w.push(`Some packings have no container load in Masters → Packing types; ${DEFAULT_PLAN_OPTIONS.defaultContainerLoadMt} MT per 20' is assumed.`);
  if (input.some((l) => !l.dispatchBy)) w.push('Some lines have no dispatch date: they are planned in a "No date" group at the end.');
  if (input.some((l) => !l.portId)) w.push('Some lines have no destination port: lots cannot be split by port for them.');
  return w;
}

export type { RequestContext };
