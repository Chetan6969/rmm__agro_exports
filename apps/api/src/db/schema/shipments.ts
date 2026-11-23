/**
 * Order planning: a proforma invoice (the order) is split into shipments (lots). Each shipment
 * carries qty, containers, target date, market (Gulf/EU) and planned charges, and later links to
 * the production order / commercial invoice / OBL made for it (pipeline, phase 3). Company-scoped
 * and RLS-isolated (both tables are in PRIVATE_COMPANY_TABLES in rls.ts).
 */
import { date, index, integer, numeric, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { id, recordColumns } from './columns.js';
import { proformaInvoices } from './documents.js';
import { companies } from './masters.js';

export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: 'restrict' }),
    proformaInvoiceId: uuid('proforma_invoice_id')
      .notNull()
      .references((): AnyPgColumn => proformaInvoices.id, { onDelete: 'cascade' }),
    lotNo: integer('lot_no').notNull(),
    market: text('market').notNull().default('GULF'), // GULF | EU
    quantityMt: numeric('quantity_mt', { precision: 14, scale: 3 }).notNull().default('0'),
    containerCount: integer('container_count').notNull().default(0),
    targetShipDate: date('target_ship_date'),
    status: text('status').notNull().default('PLANNED'), // PLANNED | IN_PROGRESS | SHIPPED | CANCELLED
    notes: text('notes'),
    // Pipeline links (phase 3) — filled when the matching document is created for this shipment.
    productionOrderId: uuid('production_order_id'),
    commercialInvoiceId: uuid('commercial_invoice_id'),
    oceanBillId: uuid('ocean_bill_id'),
    ...recordColumns(),
  },
  (t) => [index('shipments_company_idx').on(t.companyId), index('shipments_pi_idx').on(t.proformaInvoiceId)],
);

export const shipmentCharges = pgTable(
  'shipment_charges',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: 'restrict' }),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references((): AnyPgColumn => shipments.id, { onDelete: 'cascade' }),
    chargeHeadId: uuid('charge_head_id'),
    label: text('label').notNull(),
    qty: numeric('qty', { precision: 14, scale: 3 }).notNull().default('1'),
    rate: numeric('rate', { precision: 15, scale: 2 }).notNull().default('0'),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull().default('0'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shipment_charges_shipment_idx').on(t.shipmentId)],
);
