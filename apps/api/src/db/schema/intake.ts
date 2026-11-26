/**
 * Semi-automatic export flow.
 *  inbox_items            every document dropped in (any format), what was read from it and what it became
 *  extraction_templates   per-layout field positions learned from users' corrections
 *  shipment_lines         what a lot carries: pack size × destination port × MT, bags, containers
 *  shipment_documents     the lot's document checklist (export invoice, BL, phyto, fumigation…)
 *  packaging_items        packaging material an order needs (bags, inner packs, tags, strips, seals)
 *  vendor_pos             our purchase orders for that material, to packaging suppliers
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Extracted, ExtractedLine } from '@rmm/shared';
import { id, recordColumns } from './columns.js';
import { files } from './core.js';
import { companies } from './masters.js';
import { shipments } from './shipments.js';

const company = () =>
  uuid('company_id')
    .notNull()
    .references((): AnyPgColumn => companies.id, { onDelete: 'restrict' });

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: id(),
    companyId: company(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    fileName: text('file_name').notNull(),
    fileKind: text('file_kind').notNull(),
    sha256: text('sha256').notNull(),
    /** Folder path when it came from a bulk import of old folders. */
    sourcePath: text('source_path'),
    status: text('status').notNull().default('QUEUED'),
    kind: text('kind'),
    kindConfidence: numeric('kind_confidence', { precision: 4, scale: 2 }),
    readMethod: text('read_method'),
    ocrConfidence: integer('ocr_confidence'),
    pages: integer('pages'),
    text: text('text'),
    fingerprint: text('fingerprint'),
    fields: jsonb('fields').$type<Record<string, Extracted>>(),
    lines: jsonb('lines').$type<ExtractedLine[]>(),
    refs: jsonb('refs').$type<Record<string, string[]>>(),
    /** Suggested order / lot from the references in the text. */
    orderId: uuid('order_id'),
    shipmentId: uuid('shipment_id'),
    /** What confirming created or updated ("order:<id>", "lot:<id>", …). */
    result: text('result'),
    error: text('error'),
    readMs: integer('read_ms'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by'),
    ...recordColumns(),
  },
  (t) => [index('inbox_items_company_idx').on(t.companyId, t.status, t.createdAt), index('inbox_items_sha_idx').on(t.companyId, t.sha256)],
);

export const extractionTemplates = pgTable(
  'extraction_templates',
  {
    id: id(),
    companyId: company(),
    kind: text('kind').notNull(),
    fingerprint: text('fingerprint').notNull(),
    field: text('field').notNull(),
    anchor: text('anchor').notNull(),
    position: text('position').notNull(),
    uses: integer('uses').notNull().default(1),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('extraction_templates_uq').on(t.companyId, t.fingerprint, t.field)],
);

export const shipmentLines = pgTable(
  'shipment_lines',
  {
    id: id(),
    companyId: company(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references((): AnyPgColumn => shipments.id, { onDelete: 'cascade' }),
    orderLineId: uuid('order_line_id'),
    label: text('label').notNull(),
    packingTypeId: uuid('packing_type_id'),
    packingName: text('packing_name'),
    packKg: numeric('pack_kg', { precision: 10, scale: 3 }).notNull().default('0'),
    innerPacks: integer('inner_packs').notNull().default(1),
    portId: uuid('port_id'),
    portName: text('port_name'),
    quantityMt: numeric('quantity_mt', { precision: 14, scale: 3 }).notNull(),
    bags: integer('bags').notNull().default(0),
    containers: integer('containers').notNull().default(0),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('shipment_lines_shipment_idx').on(t.shipmentId)],
);

export const shipmentDocuments = pgTable(
  'shipment_documents',
  {
    id: id(),
    companyId: company(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references((): AnyPgColumn => shipments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** RECEIVED | NOT_NEEDED */
    status: text('status').notNull(),
    fileId: uuid('file_id'),
    inboxItemId: uuid('inbox_item_id'),
    refNo: text('ref_no'),
    docDate: date('doc_date', { mode: 'string' }),
    note: text('note'),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shipment_documents_uq').on(t.shipmentId, t.kind)],
);

export const packagingItems = pgTable(
  'packaging_items',
  {
    id: id(),
    companyId: company(),
    proformaInvoiceId: uuid('proforma_invoice_id').notNull(),
    component: text('component').notNull(),
    label: text('label').notNull(),
    packingTypeId: uuid('packing_type_id'),
    packingName: text('packing_name').notNull(),
    bags: integer('bags').notNull(),
    perBag: numeric('per_bag', { precision: 8, scale: 3 }).notNull(),
    freePct: numeric('free_pct', { precision: 6, scale: 2 }).notNull().default('0'),
    quantity: integer('quantity').notNull(),
    supplierId: uuid('supplier_id'),
    rate: numeric('rate', { precision: 12, scale: 4 }),
    /** TO_ORDER | ORDERED */
    status: text('status').notNull().default('TO_ORDER'),
    vendorPoId: uuid('vendor_po_id'),
    position: integer('position').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('packaging_items_order_idx').on(t.proformaInvoiceId)],
);

export const vendorPos = pgTable(
  'vendor_pos',
  {
    id: id(),
    companyId: company(),
    number: text('number').notNull(),
    poDate: date('po_date', { mode: 'string' }).notNull(),
    supplierId: uuid('supplier_id').notNull(),
    proformaInvoiceId: uuid('proforma_invoice_id'),
    /** DRAFT | SENT | RECEIVED | CANCELLED */
    status: text('status').notNull().default('DRAFT'),
    /** PACKAGING | PADDY_RICE | SERVICE | OTHER */
    category: text('category').notNull().default('PACKAGING'),
    deliveryBy: date('delivery_by', { mode: 'string' }),
    lines: jsonb('lines').$type<{ description: string; quantity: number; unit: string; rate: string; amount: string }[]>().notNull(),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    printed: boolean('printed').notNull().default(false),
    ...recordColumns(),
  },
  (t) => [uniqueIndex('vendor_pos_number_uq').on(t.companyId, t.number), index('vendor_pos_order_idx').on(t.proformaInvoiceId)],
);

/** A supplier's bill to us (packaging, paddy / rice, services), kept apart from our export invoices. */
export const purchaseInvoices = pgTable(
  'purchase_invoices',
  {
    id: id(),
    companyId: company(),
    /** The supplier's own invoice number. */
    invoiceNo: text('invoice_no').notNull(),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    supplierId: uuid('supplier_id').notNull(),
    vendorPoId: uuid('vendor_po_id'),
    proformaInvoiceId: uuid('proforma_invoice_id'),
    shipmentId: uuid('shipment_id'),
    category: text('category').notNull().default('PACKAGING'),
    description: text('description'),
    quantity: numeric('quantity', { precision: 16, scale: 3 }),
    unit: text('unit'),
    taxableAmount: numeric('taxable_amount', { precision: 15, scale: 2 }),
    gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
    dueDate: date('due_date', { mode: 'string' }),
    fileId: uuid('file_id'),
    inboxItemId: uuid('inbox_item_id'),
    notes: text('notes'),
    ...recordColumns(),
  },
  (t) => [
    // the same bill cannot be entered twice
    uniqueIndex('purchase_invoices_supplier_no_uq').on(t.companyId, t.supplierId, sql`lower(${t.invoiceNo})`).where(sql`deleted_at is null`),
    index('purchase_invoices_order_idx').on(t.proformaInvoiceId),
    index('purchase_invoices_company_date_idx').on(t.companyId, t.invoiceDate),
  ],
);
