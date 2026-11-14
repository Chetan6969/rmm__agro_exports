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
import { products } from './products.js';
import { termsAndConditions } from './terms-and-conditions.js';
import { users } from './users.js';

export const proformaInvoices = pgTable(
  'proforma_invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    documentDate: date('document_date').notNull(),
    financialYear: varchar('financial_year', { length: 16 }).notNull(),

    // Parties.
    // Legacy Swap Gotcha: Consignee in customer_id, Buyer in consignee_id
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    consigneeId: uuid('consignee_id').references(() => customers.id),
    notifyPartyId: uuid('notify_party_id').references(() => customers.id),

    // Buyer references & letter of credit (each its own queryable field)
    buyerPoRef: varchar('buyer_po_ref', { length: 128 }),
    poDate: date('po_date'),
    lcNumber: varchar('lc_number', { length: 64 }),
    lcDate: date('lc_date'),

    // Commercial terms
    incoterm: varchar('incoterm', { length: 16 }).notNull(), // 'FOB', 'CFR', 'CIF'
    currency: varchar('currency', { length: 8 }).default('USD').notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 4 })
      .default('1.0000')
      .notNull(), // "Dollar rate"
    paymentTerms: text('payment_terms').notNull(),
    deliveryTimeline: text('delivery_timeline'),

    // Shipping
    countryOfOrigin: varchar('country_of_origin', { length: 64 })
      .default('India')
      .notNull(),
    goodsCountry: varchar('goods_country', { length: 64 }),
    portOfLoading: varchar('port_of_loading', { length: 128 }).notNull(),
    portOfDischarge: varchar('port_of_discharge', { length: 128 }).notNull(),
    finalDestination: varchar('final_destination', { length: 128 }).notNull(),
    modeOfShipment: varchar('mode_of_shipment', { length: 64 })
      .default('By sea, FCL container')
      .notNull(),

    // Branding
    brand: varchar('brand', { length: 128 }),
    blend: varchar('blend', { length: 128 }),

    // Specification block (each attribute independently reportable)
    specVariety: varchar('spec_variety', { length: 64 }),
    specAvgLengthMm: numeric('spec_avg_length_mm', { precision: 6, scale: 2 }),
    specMoisturePct: numeric('spec_moisture_pct', { precision: 5, scale: 2 }),
    specBrokenPct: numeric('spec_broken_pct', { precision: 5, scale: 2 }),
    specCropYear: varchar('spec_crop_year', { length: 16 }),

    bankDetailsId: uuid('bank_details_id').references(() => bankDetails.id),

    // Totals
    totalQuantityMt: numeric('total_quantity_mt', { precision: 12, scale: 3 })
      .default('0.000')
      .notNull(),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }) // goods / FOB subtotal
      .default('0.00')
      .notNull(),
    freightAmount: numeric('freight_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    insuranceAmount: numeric('insurance_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    discountAmount: numeric('discount_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    grandTotal: numeric('grand_total', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    amountInWords: text('amount_in_words'),

    // Which sections print on this PI (each a toggle)
    showNotifyParty: boolean('show_notify_party').default(true).notNull(),
    showShippingDetails: boolean('show_shipping_details')
      .default(true)
      .notNull(),
    showSpecification: boolean('show_specification').default(true).notNull(),
    showBankDetails: boolean('show_bank_details').default(true).notNull(),
    showLcDetails: boolean('show_lc_details').default(true).notNull(),
    showTermsConditions: boolean('show_terms_conditions')
      .default(true)
      .notNull(),
    showSignatureBlock: boolean('show_signature_block').default(true).notNull(),

    frozenTerms: text('frozen_terms'), // Snapshotted terms summary

    status: varchar('status', { length: 32 }).default('CONFIRMED').notNull(), // 'DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED'
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
    uniqueIndex('uq_pi_company_number').on(
      table.companyId,
      table.documentNumber,
    ),
  ],
);

export const proformaItems = pgTable('proforma_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  proformaInvoiceId: uuid('proforma_invoice_id')
    .notNull()
    .references(() => proformaInvoices.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').default(1).notNull(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  packingTypeId: uuid('packing_type_id')
    .notNull()
    .references(() => packingTypes.id),
  packingText: text('packing_text'), // multi-line "30KG BOPP BAGS 1000MT" breakdown
  hsCode: varchar('hs_code', { length: 16 }),
  cropYear: varchar('crop_year', { length: 16 }),
  quantityMt: numeric('quantity_mt', { precision: 12, scale: 3 }).notNull(),
  allocatedProductionMt: numeric('allocated_production_mt', {
    precision: 12,
    scale: 3,
  })
    .default('0.000')
    .notNull(),
  ratePerMt: numeric('rate_per_mt', { precision: 15, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  brokenPct: numeric('broken_pct', { precision: 5, scale: 2 }),
  cgst: numeric('cgst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  sgst: numeric('sgst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  igst: numeric('igst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  specifications: text('specifications'),
});

// Each selected Term & Condition is its own row (independently reportable)
export const proformaTerms = pgTable('proforma_terms', {
  id: uuid('id').defaultRandom().primaryKey(),
  proformaInvoiceId: uuid('proforma_invoice_id')
    .notNull()
    .references(() => proformaInvoices.id, { onDelete: 'cascade' }),
  termId: uuid('term_id').references(() => termsAndConditions.id),
  position: integer('position').default(0).notNull(),
  content: text('content').notNull(), // snapshot so historical reports stay stable
});

export type ProformaInvoice = typeof proformaInvoices.$inferSelect;
export type NewProformaInvoice = typeof proformaInvoices.$inferInsert;
export type ProformaItem = typeof proformaItems.$inferSelect;
export type NewProformaItem = typeof proformaItems.$inferInsert;
export type ProformaTerm = typeof proformaTerms.$inferSelect;
export type NewProformaTerm = typeof proformaTerms.$inferInsert;
