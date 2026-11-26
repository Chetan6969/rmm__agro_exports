/**
 * Buying side, kept apart from sales: our purchase orders to suppliers and the purchase invoices
 * (bills) they send us. Both can belong to an order (and a lot), so each order file shows them.
 */
import { add, isDecimal, mul, PURCHASE_CATEGORY_KEYS, round, sub } from '@rmm/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { requireCompany, type RequestContext } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables, masterTables, purchaseInvoices, shipments, vendorPos } from '../../db/schema/index.js';
import { allocateNumber, noteTypedNumber } from '../numbering.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const amount = z.string().trim().refine((v) => v === '' || isDecimal(v), 'Enter a number');
const category = z.enum(PURCHASE_CATEGORY_KEYS);

export const purchaseInvoiceSchema = z.object({
  invoiceNo: z.string().trim().min(1, "Enter the supplier's invoice number").max(80),
  invoiceDate: dateStr,
  supplierId: z.uuid('Choose the supplier'),
  vendorPoId: z.uuid().nullable().optional(),
  proformaInvoiceId: z.uuid().nullable().optional(),
  shipmentId: z.uuid().nullable().optional(),
  category: category.default('PACKAGING'),
  description: z.string().trim().max(500).nullable().optional(),
  quantity: amount.nullable().optional(),
  unit: z.string().trim().max(16).nullable().optional(),
  taxableAmount: amount.nullable().optional(),
  gstAmount: amount.nullable().optional(),
  totalAmount: z.string().trim().refine((v) => isDecimal(v) && Number(v) > 0, 'Enter the invoice total'),
  paidAmount: amount.nullable().optional(),
  dueDate: dateStr.nullable().optional(),
  fileId: z.uuid().nullable().optional(),
  inboxItemId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const purchaseOrderSchema = z.object({
  /** Leave empty to take the next number. */
  number: z.string().trim().max(60).nullable().optional(),
  poDate: dateStr,
  supplierId: z.uuid('Choose the supplier'),
  category: category.default('PACKAGING'),
  proformaInvoiceId: z.uuid().nullable().optional(),
  deliveryBy: dateStr.nullable().optional(),
  status: z.enum(['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED']).default('DRAFT'),
  notes: z.string().max(2000).nullable().optional(),
  lines: z
    .array(z.object({ description: z.string().trim().min(1, 'Describe the item').max(300), quantity: z.coerce.number().positive('Enter a quantity').max(1e12), unit: z.string().trim().max(12).default('Nos'), rate: amount.default('') }))
    .min(1, 'Add at least one item')
    .max(60),
});

const blank = (v: string | null | undefined) => (v === undefined || v === null || v === '' ? null : v);
export const paymentStatus = (total: string, paid: string) => (Number(paid) <= 0 ? 'UNPAID' : Number(paid) + 0.005 < Number(total) ? 'PART' : 'PAID');

/** Supplier, purchase order, order and lot must exist in this company and agree with each other. */
async function links(tx: Tx, p: { supplierId: string; vendorPoId?: string | null; proformaInvoiceId?: string | null; shipmentId?: string | null }) {
  const su = masterTables.suppliers;
  const [s] = await tx.select({ id: su.id }).from(su).where(and(eq(su.id, p.supplierId), isNull(su.deletedAt)));
  if (!s) throw badRequest('That supplier is not available', { fields: { supplierId: 'Not found' } });
  let orderId = p.proformaInvoiceId ?? null;
  if (p.vendorPoId) {
    const [po] = await tx.select().from(vendorPos).where(and(eq(vendorPos.id, p.vendorPoId), isNull(vendorPos.deletedAt)));
    if (!po) throw badRequest('That purchase order is not available', { fields: { vendorPoId: 'Not found' } });
    if (po.supplierId !== p.supplierId) throw badRequest(`Purchase order ${po.number} is for another supplier`, { fields: { vendorPoId: 'Other supplier' } });
    if (po.proformaInvoiceId && orderId && po.proformaInvoiceId !== orderId) throw badRequest(`Purchase order ${po.number} belongs to another order`, { fields: { proformaInvoiceId: 'Does not match the purchase order' } });
    orderId = orderId ?? po.proformaInvoiceId;
  }
  if (p.shipmentId) {
    const [lot] = await tx.select({ orderId: shipments.proformaInvoiceId }).from(shipments).where(and(eq(shipments.id, p.shipmentId), isNull(shipments.deletedAt)));
    if (!lot) throw badRequest('That lot is not available', { fields: { shipmentId: 'Not found' } });
    if (orderId && lot.orderId !== orderId) throw badRequest('That lot belongs to another order', { fields: { shipmentId: 'Other order' } });
    orderId = lot.orderId;
  }
  if (orderId) {
    const pi = docTables.proformaInvoices.header;
    const [o] = await tx.select({ id: pi.id }).from(pi).where(and(eq(pi.id, orderId), isNull(pi.deletedAt)));
    if (!o) throw badRequest('That order is not available', { fields: { proformaInvoiceId: 'Not found' } });
  }
  return orderId;
}

async function assertNewBill(tx: Tx, supplierId: string, invoiceNo: string, selfId?: string) {
  const [dupe] = await tx
    .select({ id: purchaseInvoices.id })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.supplierId, supplierId), sql`lower(${purchaseInvoices.invoiceNo}) = lower(${invoiceNo})`, isNull(purchaseInvoices.deletedAt)))
    .limit(1);
  if (dupe && dupe.id !== selfId) throw conflict(`Invoice ${invoiceNo} of this supplier is already entered`, 'Open the existing purchase invoice instead of entering the bill twice.');
}

function billValues(p: z.infer<typeof purchaseInvoiceSchema>, orderId: string | null) {
  const taxable = blank(p.taxableAmount);
  const gst = blank(p.gstAmount);
  const paid = blank(p.paidAmount) ?? '0';
  if (Number(paid) > Number(p.totalAmount) + 0.005) throw badRequest('The paid amount is more than the invoice total', { fields: { paidAmount: 'More than the total' } });
  return {
    invoiceNo: p.invoiceNo,
    invoiceDate: p.invoiceDate,
    supplierId: p.supplierId,
    vendorPoId: p.vendorPoId ?? null,
    proformaInvoiceId: orderId,
    shipmentId: p.shipmentId ?? null,
    category: p.category,
    description: blank(p.description),
    quantity: blank(p.quantity),
    unit: blank(p.unit),
    // the taxable value is the total less GST when the bill does not state it
    taxableAmount: taxable ?? (gst ? sub(p.totalAmount, gst, 2) : null),
    gstAmount: gst,
    totalAmount: p.totalAmount,
    paidAmount: paid,
    dueDate: p.dueDate ?? null,
    fileId: p.fileId ?? null,
    inboxItemId: p.inboxItemId ?? null,
    notes: blank(p.notes),
  };
}

export async function createPurchaseInvoice(tx: Tx, ctx: RequestContext, body: unknown) {
  const companyId = requireCompany(ctx);
  const p = purchaseInvoiceSchema.parse(body);
  const orderId = await links(tx, p);
  await assertNewBill(tx, p.supplierId, p.invoiceNo);
  const [row] = await tx.insert(purchaseInvoices).values({ ...billValues(p, orderId), companyId, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
  await audit(tx, ctx, { entity: 'purchaseInvoices', recordId: row.id, action: 'create', after: row });
  return row;
}

export async function updatePurchaseInvoice(tx: Tx, ctx: RequestContext, id: string, body: unknown) {
  const p = purchaseInvoiceSchema.extend({ version: z.number().int() }).parse(body);
  const [before] = await tx.select().from(purchaseInvoices).where(and(eq(purchaseInvoices.id, id), isNull(purchaseInvoices.deletedAt)));
  if (!before) throw notFound('Purchase invoice not found');
  if (before.version !== p.version) throw conflict('This purchase invoice was changed by another user while you were editing');
  const orderId = await links(tx, p);
  await assertNewBill(tx, p.supplierId, p.invoiceNo, id);
  const [after] = await tx
    .update(purchaseInvoices)
    .set({ ...billValues({ ...p, fileId: p.fileId === undefined ? before.fileId : p.fileId, inboxItemId: p.inboxItemId === undefined ? before.inboxItemId : p.inboxItemId }, orderId), version: sql`${purchaseInvoices.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
    .where(eq(purchaseInvoices.id, id))
    .returning();
  await audit(tx, ctx, { entity: 'purchaseInvoices', recordId: id, action: 'update', before, after });
  return after;
}

export async function createPurchaseOrder(tx: Tx, ctx: RequestContext, body: unknown) {
  const companyId = requireCompany(ctx);
  const p = purchaseOrderSchema.parse(body);
  const orderId = await links(tx, { supplierId: p.supplierId, proformaInvoiceId: p.proformaInvoiceId });
  const typed = blank(p.number);
  if (typed) {
    const [clash] = await tx.select({ id: vendorPos.id }).from(vendorPos).where(and(eq(vendorPos.number, typed), isNull(vendorPos.deletedAt)));
    if (clash) throw conflict(`Purchase order number ${typed} is already used`, 'Leave the number empty to take the next one, or open the existing purchase order.');
  }
  if (typed) await noteTypedNumber(tx, ctx, 'purchase_order', p.poDate, typed);
  const number = typed ?? (await allocateNumber(tx, ctx, 'purchase_order', p.poDate));
  const lines = p.lines.map((l) => ({ ...l, amount: l.rate ? round(mul(String(l.quantity), l.rate, 2), 2) : '0' }));
  const [po] = await tx
    .insert(vendorPos)
    .values({ companyId, number, poDate: p.poDate, supplierId: p.supplierId, category: p.category, proformaInvoiceId: orderId, status: p.status, deliveryBy: p.deliveryBy ?? null, lines, totalAmount: add(lines.map((l) => l.amount), 2), notes: blank(p.notes), createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning();
  await audit(tx, ctx, { entity: 'vendorPos', recordId: po.id, action: 'create', meta: { number, supplierId: p.supplierId, category: p.category } });
  return po;
}
