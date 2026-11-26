/**
 * Order files — everything about one order (PO or PI) in one place:
 *  /order-files        paginated list of orders with where each one stands
 *  /order-files/:id    its lots, documents (in folders), packaging, freight and payments
 * Each section is returned only to users who may view that kind of record.
 */
import { businessDate, checklistFor, intakeKind } from '@rmm/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { can, inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { billedByPo, listPurchaseInvoices } from '../purchases/purchases.routes.js';
import { docTables, freightEnquiries, inboxItems, masterTables, packagingItems, payments, shipmentDocuments, shipmentLines, shipments, vendorPos } from '../../db/schema/index.js';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const PAGE = 25;

type NextStep = 'LINES' | 'PLAN' | 'PACKAGING' | 'ORDER_PACKAGING' | 'SHIP' | 'DOCUMENTS' | 'PAYMENT' | 'DONE' | 'CANCELLED';

interface Facts {
  totalMt: number;
  status: string;
  lots: Row[];
  docs: { shipmentId: string; kind: string; status: string }[];
  packaging: { status: string }[];
  toReview: number;
  invoiced: number;
  received: number;
}

/** Where an order stands, from what exists for it. */
export function orderProgress(f: Facts) {
  const live = f.lots.filter((l) => l.status !== 'CANCELLED');
  const today = businessDate();
  let docsNeeded = 0;
  let docsDone = 0;
  const alerts: string[] = [];
  for (const l of live) {
    const need = checklistFor(str(l.market));
    docsNeeded += need.length;
    docsDone += need.filter((k) => f.docs.some((d) => d.shipmentId === l.id && d.kind === k)).length;
    if (l.targetShipDate && str(l.targetShipDate) < today && l.status === 'PLANNED') alerts.push(`Lot ${l.lotNo}: ship date passed`);
    if (l.eta && str(l.eta) < today && !['RECEIVED', 'RELEASED'].includes(str(l.blStatus))) alerts.push(`Lot ${l.lotNo}: vessel arrived, BL not received`);
    if (l.leoDate && !l.blNumber) alerts.push(`Lot ${l.lotNo}: LEO done, BL missing`);
  }
  const plannedMt = live.reduce((s, l) => s + Number(l.quantityMt), 0);
  const shipped = live.filter((l) => l.status === 'SHIPPED' || ['RECEIVED', 'RELEASED'].includes(str(l.blStatus))).length;
  const toOrder = f.packaging.filter((p) => p.status === 'TO_ORDER').length;
  let next: NextStep;
  if (f.status === 'CANCELLED') next = 'CANCELLED';
  else if (f.status === 'FULFILLED') next = 'DONE';
  else if (!f.totalMt) next = 'LINES';
  else if (!live.length || plannedMt + 0.001 < f.totalMt) next = 'PLAN';
  else if (shipped < live.length && !f.packaging.length) next = 'PACKAGING';
  else if (shipped < live.length && toOrder) next = 'ORDER_PACKAGING';
  else if (shipped < live.length) next = 'SHIP';
  else if (docsDone < docsNeeded) next = 'DOCUMENTS';
  else if (!f.invoiced || f.received + 0.5 < f.invoiced) next = 'PAYMENT';
  else next = 'DONE';
  return {
    next,
    lots: live.length,
    shipped,
    plannedMt: Math.round(plannedMt * 1000) / 1000,
    containers: live.reduce((s, l) => s + Number(l.containerCount), 0),
    nextShipDate: live.filter((l) => l.status !== 'SHIPPED' && l.targetShipDate).map((l) => str(l.targetShipDate)).sort()[0] ?? null,
    docsDone,
    docsNeeded,
    packagingToOrder: toOrder,
    packagingLines: f.packaging.length,
    toReview: f.toReview,
    invoiced: f.invoiced,
    received: f.received,
    alerts,
  };
}

const OPEN_INBOX = ['QUEUED', 'READING', 'TO_REVIEW', 'FAILED'];

/** Lots, lot documents, packaging, inbox counts and money for a set of orders. */
async function factsFor(tx: Tx, orderIds: string[]) {
  if (!orderIds.length) return { lots: [] as Row[], docs: [] as Facts['docs'], packaging: [] as { orderId: string; status: string }[], review: [] as { orderId: string | null; n: number }[], money: [] as { orderId: string; invoiced: number; received: number }[] };
  const lots = (await tx.select().from(shipments).where(and(inArray(shipments.proformaInvoiceId, orderIds), isNull(shipments.deletedAt))).orderBy(asc(shipments.lotNo))) as Row[];
  const lotIds = lots.map((l) => l.id as string);
  const docs = lotIds.length ? await tx.select({ shipmentId: shipmentDocuments.shipmentId, kind: shipmentDocuments.kind, status: shipmentDocuments.status }).from(shipmentDocuments).where(inArray(shipmentDocuments.shipmentId, lotIds)) : [];
  const packaging = await tx.select({ orderId: packagingItems.proformaInvoiceId, status: packagingItems.status }).from(packagingItems).where(inArray(packagingItems.proformaInvoiceId, orderIds));
  const review = await tx
    .select({ orderId: inboxItems.orderId, n: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(and(inArray(inboxItems.orderId, orderIds), inArray(inboxItems.status, OPEN_INBOX), isNull(inboxItems.deletedAt)))
    .groupBy(inboxItems.orderId);
  const ciIds = lots.map((l) => l.commercialInvoiceId as string).filter(Boolean);
  const paid = ciIds.length
    ? await tx.select({ ci: payments.commercialInvoiceId, amount: sql<string>`coalesce(sum(${payments.amount}), 0)::text` }).from(payments).where(and(inArray(payments.commercialInvoiceId, ciIds), isNull(payments.deletedAt))).groupBy(payments.commercialInvoiceId)
    : [];
  const money = orderIds.map((id) => {
    const mine = lots.filter((l) => l.proformaInvoiceId === id && l.status !== 'CANCELLED');
    return {
      orderId: id,
      invoiced: mine.reduce((s, l) => s + Number(l.invoiceAmount ?? 0), 0),
      received: [...new Set(mine.map((l) => l.commercialInvoiceId).filter(Boolean))].reduce<number>((s, ci) => s + Number(paid.find((p) => p.ci === ci)?.amount ?? 0), 0),
    };
  });
  return { lots, docs, packaging, review, money };
}

function pick(f: Awaited<ReturnType<typeof factsFor>>, o: Row): Facts {
  const lots = f.lots.filter((l) => l.proformaInvoiceId === o.id);
  const ids = new Set(lots.map((l) => l.id));
  const m = f.money.find((x) => x.orderId === o.id);
  return {
    totalMt: Number(o.totalMt ?? 0),
    status: str(o.status),
    lots,
    docs: f.docs.filter((d) => ids.has(d.shipmentId)),
    packaging: f.packaging.filter((p) => p.orderId === o.id),
    toReview: f.review.find((r) => r.orderId === o.id)?.n ?? 0,
    invoiced: m?.invoiced ?? 0,
    received: m?.received ?? 0,
  };
}

const header = () => {
  const pi = docTables.proformaInvoices.header;
  const cu = masterTables.customers;
  const cur = masterTables.currencies;
  return {
    pi,
    cu,
    cur,
    columns: { id: pi.id, number: pi.documentNumber, date: pi.documentDate, status: pi.status, orderSource: pi.orderSource, buyer: cu.name, buyerPoRef: pi.buyerPoRef, lcNumber: pi.lcNumber, totalMt: pi.totalQuantityMt, amount: pi.grandTotal, currency: cur.code },
  };
};

/** An order is "done" once fulfilled or cancelled, or when every lot it has is shipped and nothing is left to plan. */
const doneSql = (pi: ReturnType<typeof header>['pi']) => sql`(${pi.status} in ('FULFILLED','CANCELLED') or (
  exists (select 1 from shipments s where s.proforma_invoice_id = ${pi.id} and s.deleted_at is null and s.status <> 'CANCELLED')
  and not exists (select 1 from shipments s where s.proforma_invoice_id = ${pi.id} and s.deleted_at is null and s.status <> 'CANCELLED' and s.status <> 'SHIPPED' and s.bl_status not in ('RECEIVED','RELEASED'))
  and (select coalesce(sum(s.quantity_mt), 0) from shipments s where s.proforma_invoice_id = ${pi.id} and s.deleted_at is null and s.status <> 'CANCELLED') >= ${pi.totalQuantityMt} - 0.001
))`;

async function orderList(tx: Tx, q: { search?: string; state?: string; page?: string; source?: string }) {
  const { pi, cu, cur, columns } = header();
  const base: SQL[] = [isNull(pi.deletedAt)];
  if (q.search?.trim()) {
    const s = `%${q.search.trim().replace(/[%_\\]/g, '\\$&')}%`;
    base.push(
      or(
        ilike(pi.documentNumber, s),
        ilike(pi.buyerPoRef, s),
        ilike(pi.lcNumber, s),
        ilike(cu.name, s),
        sql`exists (select 1 from shipments s where s.proforma_invoice_id = ${pi.id} and s.deleted_at is null and (s.invoice_number ilike ${s} or s.bl_number ilike ${s} or s.booking_no ilike ${s}))`,
      )!,
    );
  }
  // Buyer's PO orders and our own PIs can be listed apart
  if (q.source === 'po') base.push(ne(pi.orderSource, 'Our PI'));
  if (q.source === 'pi') base.push(eq(pi.orderSource, 'Our PI'));
  const state = q.state === 'done' || q.state === 'all' ? q.state : 'running';
  const conds = [...base];
  if (state === 'done') conds.push(doneSql(pi));
  if (state === 'running') conds.push(sql`not ${doneSql(pi)}`);
  const page = Math.max(1, Number(q.page) || 1);
  const rows = (await tx
    .select(columns)
    .from(pi)
    .leftJoin(cu, eq(cu.id, pi.buyerId))
    .leftJoin(cur, eq(cur.id, pi.currencyId))
    .where(and(...conds))
    .orderBy(desc(pi.documentDate), desc(pi.documentNumber))
    .limit(PAGE)
    .offset((page - 1) * PAGE)) as Row[];
  const [totals] = (await tx
    .select({
      running: sql<number>`count(*) filter (where not ${doneSql(pi)})::int`,
      done: sql<number>`count(*) filter (where ${doneSql(pi)})::int`,
    })
    .from(pi)
    .leftJoin(cu, eq(cu.id, pi.buyerId))
    .where(and(...base))) as { running: number; done: number }[];
  const facts = await factsFor(tx, rows.map((r) => r.id as string));
  const total = state === 'running' ? totals.running : state === 'done' ? totals.done : totals.running + totals.done;
  return { rows: rows.map((o) => ({ ...o, progress: orderProgress(pick(facts, o)) })), total, page, pageSize: PAGE, counts: { running: totals.running, done: totals.done, all: totals.running + totals.done } };
}

const inboxColumns = {
  id: inboxItems.id,
  fileId: inboxItems.fileId,
  fileName: inboxItems.fileName,
  kind: inboxItems.kind,
  status: inboxItems.status,
  shipmentId: inboxItems.shipmentId,
  createdAt: inboxItems.createdAt,
};

async function orderFile(tx: Tx, ctx: RequestContext, id: string) {
  const { pi, cu, cur, columns } = header();
  const [order] = (await tx.select(columns).from(pi).leftJoin(cu, eq(cu.id, pi.buyerId)).leftJoin(cur, eq(cur.id, pi.currencyId)).where(and(eq(pi.id, id), isNull(pi.deletedAt)))) as Row[];
  if (!order) throw notFound('Order not found', 'It may have been deleted (see the recycle bin), or it belongs to another company.');
  const facts = await factsFor(tx, [id]);
  const f = pick(facts, order);
  const lotIds = f.lots.map((l) => l.id as string);
  const lines = lotIds.length ? await tx.select().from(shipmentLines).where(inArray(shipmentLines.shipmentId, lotIds)).orderBy(asc(shipmentLines.position)) : [];
  const lotDocs = lotIds.length ? await tx.select().from(shipmentDocuments).where(inArray(shipmentDocuments.shipmentId, lotIds)) : [];
  const canInbox = can(ctx, 'sales.intake', 'view');
  const inbox = canInbox
    ? await tx
        .select(inboxColumns)
        .from(inboxItems)
        .where(and(isNull(inboxItems.deletedAt), ne(inboxItems.status, 'IGNORED'), lotIds.length ? or(eq(inboxItems.orderId, id), inArray(inboxItems.shipmentId, lotIds)) : eq(inboxItems.orderId, id)))
        .orderBy(desc(inboxItems.createdAt))
    : [];

  // documents made inside the ERP for this order (each only for users who may view that kind)
  const made: { key: string; label: string; id: string; number: string; date: string; status: string; shipmentId: string | null }[] = [];
  const collect = async (key: 'productionOrders' | 'commercialInvoices' | 'oceanBills' | 'certificates', label: string, where: SQL) => {
    if (!can(ctx, `sales.${key}`, 'view')) return [] as string[];
    const h = docTables[key].header;
    const rows = (await tx.select({ id: h.id, number: h.documentNumber, date: h.documentDate, status: h.status }).from(h).where(and(isNull(h.deletedAt), where)).orderBy(asc(h.documentDate))) as { id: string; number: string; date: string; status: string }[];
    const link = key === 'productionOrders' ? 'productionOrderId' : key === 'commercialInvoices' ? 'commercialInvoiceId' : key === 'oceanBills' ? 'oceanBillId' : null;
    for (const r of rows) made.push({ key, label, ...r, shipmentId: link ? ((f.lots.find((l) => l[link] === r.id)?.id as string) ?? null) : null });
    return rows.map((r) => r.id);
  };
  const po = docTables.productionOrders.header;
  const ci = docTables.commercialInvoices.header;
  await collect('productionOrders', 'Production order', eq(po.proformaInvoiceId, id));
  const linkedCis = f.lots.map((l) => l.commercialInvoiceId as string).filter(Boolean);
  const ciIds = await collect('commercialInvoices', 'Commercial invoice', linkedCis.length ? or(eq(ci.proformaInvoiceId, id), inArray(ci.id, linkedCis))! : eq(ci.proformaInvoiceId, id));
  if (ciIds.length) {
    await collect('oceanBills', 'Bill of lading', inArray(docTables.oceanBills.header.commercialInvoiceId, ciIds));
    await collect('certificates', 'Certificate', inArray(docTables.certificates.header.commercialInvoiceId, ciIds));
  }

  const supplierName = async (ids: string[]) => {
    const su = masterTables.suppliers;
    return ids.length ? ((await tx.select({ id: su.id, name: su.name }).from(su).where(inArray(su.id, ids))) as { id: string; name: string }[]) : [];
  };
  const pos = can(ctx, 'sales.vendorPos', 'view') ? await tx.select().from(vendorPos).where(and(eq(vendorPos.proformaInvoiceId, id), isNull(vendorPos.deletedAt))).orderBy(desc(vendorPos.poDate), desc(vendorPos.number)) : [];
  const suppliers = await supplierName([...new Set(pos.map((p) => p.supplierId))]);
  const freight = can(ctx, 'sales.freight', 'view')
    ? await tx
        .select({ id: freightEnquiries.id, number: freightEnquiries.number, status: freightEnquiries.status, date: freightEnquiries.enquiryDate, portOfLoading: freightEnquiries.portOfLoading, portOfDischarge: freightEnquiries.portOfDischarge, containerCount: freightEnquiries.containerCount, shipmentId: freightEnquiries.shipmentId, awardedTo: sql<string | null>`(select t.carrier from freight_threads t where t.id = freight_enquiries.awarded_thread_id)` })
        .from(freightEnquiries)
        .where(and(isNull(freightEnquiries.deletedAt), lotIds.length ? or(eq(freightEnquiries.proformaInvoiceId, id), inArray(freightEnquiries.shipmentId, lotIds)) : eq(freightEnquiries.proformaInvoiceId, id)))
        .orderBy(desc(freightEnquiries.enquiryDate))
    : [];
  const received = can(ctx, 'sales.payments', 'view') && ciIds.length
    ? await tx.select({ id: payments.id, date: payments.paymentDate, amount: payments.amount, mode: payments.mode, reference: payments.reference, commercialInvoiceId: payments.commercialInvoiceId }).from(payments).where(and(inArray(payments.commercialInvoiceId, ciIds), isNull(payments.deletedAt))).orderBy(desc(payments.paymentDate))
    : [];

  const billed = await billedByPo(tx, pos.map((p) => p.id));
  const bills = can(ctx, 'sales.purchaseInvoices', 'view') ? await listPurchaseInvoices(tx, { orderId: id }) : [];

  const lots = f.lots.map((l) => {
    const need = checklistFor(str(l.market));
    const mine = lotDocs.filter((d) => d.shipmentId === l.id);
    const keys = [...need, ...mine.map((d) => d.kind).filter((k) => !need.includes(k))];
    return {
      ...l,
      lines: lines.filter((x) => x.shipmentId === l.id),
      checklist: keys.map((k) => {
        const d = mine.find((x) => x.kind === k);
        return { kind: k, label: intakeKind(k).label, required: need.includes(k), status: d?.status ?? 'PENDING', fileId: d?.fileId ?? null, refNo: d?.refNo ?? null, docDate: d?.docDate ?? null };
      }),
      files: inbox.filter((i) => i.shipmentId === l.id && i.status === 'CONFIRMED').map((i) => ({ ...i, label: intakeKind(i.kind).label })),
      documents: made.filter((m) => m.shipmentId === l.id),
    };
  });
  return {
    order,
    progress: orderProgress(f),
    lots,
    /** Order-level folders; files of a lot are inside that lot. */
    folders: {
      toReview: inbox.filter((i) => OPEN_INBOX.includes(i.status)).map((i) => ({ ...i, label: i.kind ? intakeKind(i.kind).label : 'Being read' })),
      orderPapers: inbox.filter((i) => i.status === 'CONFIRMED' && !i.shipmentId).map((i) => ({ ...i, label: intakeKind(i.kind).label })),
      documents: made.filter((m) => !m.shipmentId),
    },
    vendorPos: pos.map((p) => ({ id: p.id, number: p.number, poDate: p.poDate, status: p.status, category: p.category, totalAmount: p.totalAmount, billedAmount: billed.get(p.id) ?? '0', items: p.lines.length, supplierName: suppliers.find((s) => s.id === p.supplierId)?.name ?? null })),
    purchaseInvoices: bills,
    freight,
    payments: received,
  };
}

export async function orderFileRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { search?: string; state?: string; page?: string; source?: string } }>('/order-files', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.proformaInvoices', 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, (tx) => orderList(tx, req.query));
  });

  app.get<{ Params: { id: string } }>('/order-files/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.proformaInvoices', 'view');
    requireCompany(ctx);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Order not found');
    return inTenantTx(ctx, (tx) => orderFile(tx, ctx, req.params.id));
  });
}
