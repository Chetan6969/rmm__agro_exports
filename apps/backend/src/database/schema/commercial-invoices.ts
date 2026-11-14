import {
  pgTable,
  uuid,
  varchar,
  date,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { bankDetails } from './bank-details.js';
import { companies } from './companies.js';
import { customers } from './customers.js';
import { packingTypes } from './packing-types.js';
import { productionOrders } from './production-orders.js';
import { products } from './products.js';
import { proformaInvoices } from './proforma-invoices.js';
import { shippingLines } from './shipping-lines.js';
import { termsAndConditions } from './terms-and-conditions.js';
import { users } from './users.js';

export const commercialInvoices = pgTable(
  'commercial_invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    documentDate: date('document_date').notNull(),
    financialYear: varchar('financial_year', { length: 16 }).notNull(), // e.g. "26-27"

    proformaInvoiceId: uuid('proforma_invoice_id').references(
      () => proformaInvoices.id,
    ),
    productionOrderId: uuid('production_order_id').references(
      () => productionOrders.id,
    ),
    buyerPoNumber: varchar('buyer_po_number', { length: 64 }),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    consigneeId: uuid('consignee_id').references(() => customers.id),
    notifyPartyId: uuid('notify_party_id').references(() => customers.id),

    invoiceType: varchar('invoice_type', { length: 16 })
      .default('WHITE')
      .notNull(), // 'WHITE', 'CUSTOM', ...
    lcNumber: varchar('lc_number', { length: 64 }),
    lcDate: date('lc_date'),
    shippingLineId: uuid('shipping_line_id').references(() => shippingLines.id),
    preCarriageBy: varchar('pre_carriage_by', { length: 128 }),
    placeOfReceipt: varchar('place_of_receipt', { length: 128 }),
    containerNo: varchar('container_no', { length: 64 }),
    sealNo: varchar('seal_no', { length: 64 }),
    ladingBlNumber: varchar('lading_bl_number', { length: 64 }),
    ladingBlDate: date('lading_bl_date'),
    termsOf: varchar('terms_of', { length: 128 }),
    paymentTerm: varchar('payment_term', { length: 255 }),
    brand: varchar('brand', { length: 128 }),
    marksNumbers: text('marks_numbers'),
    goodsDescription: text('goods_description'),
    grossWtMt: numeric('gross_wt_mt', { precision: 12, scale: 3 }),
    fcl: varchar('fcl', { length: 32 }),
    freightAmount: numeric('freight_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    totalChargesAmount: numeric('total_charges_amount', {
      precision: 15,
      scale: 2,
    })
      .default('0.00')
      .notNull(),
    showSignature: boolean('show_signature').default(true).notNull(),

    shippingBillNumber: varchar('shipping_bill_number', { length: 64 }),
    shippingBillDate: date('shipping_bill_date'),
    blNumber: varchar('bl_number', { length: 64 }),
    blDate: date('bl_date'),
    vesselFlightName: varchar('vessel_flight_name', { length: 128 }),
    voyageNumber: varchar('voyage_number', { length: 64 }),
    portOfLoading: varchar('port_of_loading', { length: 128 }),
    portOfDischarge: varchar('port_of_discharge', { length: 128 }),
    countryOfOrigin: varchar('country_of_origin', { length: 64 })
      .default('India')
      .notNull(),
    countryOfDestination: varchar('country_of_destination', { length: 64 }),

    incoterm: varchar('incoterm', { length: 16 }).notNull(), // 'FOB', 'CFR', 'CIF'
    currency: varchar('currency', { length: 8 }).default('USD').notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 4 })
      .default('1.0000')
      .notNull(),

    totalFobAmount: numeric('total_fob_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    oceanFreightAmount: numeric('ocean_freight_amount', {
      precision: 15,
      scale: 2,
    })
      .default('0.00')
      .notNull(),
    insuranceAmount: numeric('insurance_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    totalInvoiceAmount: numeric('total_invoice_amount', {
      precision: 15,
      scale: 2,
    })
      .default('0.00')
      .notNull(),
    amountInWords: text('amount_in_words'),

    lutNumber: varchar('lut_number', { length: 64 }),
    bankDetailsId: uuid('bank_details_id').references(() => bankDetails.id),
    frozenTerms: text('frozen_terms'),

    status: varchar('status', { length: 32 }).default('ISSUED').notNull(), // 'ISSUED', 'NEGOTIATED', 'PAID', 'CANCELLED'
    version: integer('version').default(1).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_inv_company_fy_number').on(
      table.companyId,
      table.financialYear,
      table.documentNumber,
    ),
  ],
);

export const invoiceItems = pgTable('invoice_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => commercialInvoices.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').default(1).notNull(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  packingTypeId: uuid('packing_type_id').references(() => packingTypes.id),
  packingText: text('packing_text'),
  hsCode: varchar('hs_code', { length: 16 }),
  noOfBags: integer('no_of_bags').default(0).notNull(),
  quantityMt: numeric('quantity_mt', { precision: 12, scale: 3 }).notNull(),
  grossWtMt: numeric('gross_wt_mt', { precision: 12, scale: 3 }),
  ratePerMt: numeric('rate_per_mt', { precision: 15, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  cgst: numeric('cgst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  sgst: numeric('sgst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  igst: numeric('igst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  brokenBelow: boolean('broken_below').default(false).notNull(),
  fcl: boolean('fcl').default(false).notNull(),
  specifications: text('specifications'),
});

// Each selected Term & Condition on an invoice is its own queryable row
export const invoiceTerms = pgTable('invoice_terms', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => commercialInvoices.id, { onDelete: 'cascade' }),
  termId: uuid('term_id').references(() => termsAndConditions.id),
  position: integer('position').default(0).notNull(),
  content: text('content').notNull(),
});

// Rule 7: Incoterm-driven shipping charges
export const shippingCharges = pgTable('shipping_charges', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .unique()
    .references(() => commercialInvoices.id, { onDelete: 'cascade' }),
  incoterm: varchar('incoterm', { length: 16 }).notNull(),
  thcCharge: numeric('thc_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  blCharge: numeric('bl_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  sealCharge: numeric('seal_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  mucCharge: numeric('muc_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  riskCharge: numeric('risk_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  repositionCharge: numeric('reposition_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  oceanFreightCharge: numeric('ocean_freight_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  insuranceCharge: numeric('insurance_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
  totalShippingCharge: numeric('total_shipping_charge', { precision: 12, scale: 2 }).default('0.00').notNull(),
});

// Containers feeding the Packing List
export const containers = pgTable('containers', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => commercialInvoices.id, { onDelete: 'cascade' }),
  containerNumber: varchar('container_number', { length: 32 }).notNull(),
  sealNumber: varchar('seal_number', { length: 32 }).notNull(),
  containerSize: varchar('container_size', { length: 16 }).default('20FT').notNull(),
  totalBags: integer('total_bags').notNull(),
  grossWeightKg: numeric('gross_weight_kg', { precision: 12, scale: 3 }).notNull(),
  netWeightKg: numeric('net_weight_kg', { precision: 12, scale: 3 }).notNull(),
});

export type CommercialInvoice = typeof commercialInvoices.$inferSelect;
export type NewCommercialInvoice = typeof commercialInvoices.$inferInsert;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type NewInvoiceItem = typeof invoiceItems.$inferInsert;
export type InvoiceTerm = typeof invoiceTerms.$inferSelect;
export type NewInvoiceTerm = typeof invoiceTerms.$inferInsert;
export type ShippingCharge = typeof shippingCharges.$inferSelect;
export type NewShippingCharge = typeof shippingCharges.$inferInsert;
export type Container = typeof containers.$inferSelect;
export type NewContainer = typeof containers.$inferInsert;
