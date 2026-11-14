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
import { companies } from './companies.js';
import { customers } from './customers.js';
import { packingTypes } from './packing-types.js';
import { products } from './products.js';
import { proformaInvoices, proformaItems } from './proforma-invoices.js';
import { suppliers } from './suppliers.js';
import { termsAndConditions } from './terms-and-conditions.js';
import { users } from './users.js';

export const productionOrders = pgTable(
  'production_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    documentDate: date('document_date').notNull(),

    // Optional "generate against PI" linkage
    proformaInvoiceId: uuid('proforma_invoice_id').references(
      () => proformaInvoices.id,
    ),
    buyerPoNumber: varchar('buyer_po_number', { length: 64 }),
    buyerPoRef: varchar('buyer_po_ref', { length: 128 }),
    poDate: date('po_date'),
    supplierMillId: uuid('supplier_mill_id').references(() => suppliers.id),

    // Parties
    customerId: uuid('customer_id').references(() => customers.id),
    consigneeId: uuid('consignee_id').references(() => customers.id),
    notifyPartyId: uuid('notify_party_id').references(() => customers.id),

    // Commercial
    incoterm: varchar('incoterm', { length: 16 }).default('FOB').notNull(),
    currency: varchar('currency', { length: 8 }).default('USD').notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 4 })
      .default('1.0000')
      .notNull(),
    lcNumber: varchar('lc_number', { length: 64 }),
    lcDate: date('lc_date'),
    freightAmount: numeric('freight_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    insuranceAmount: numeric('insurance_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    fcl: varchar('fcl', { length: 32 }),

    // Shipping
    preCarriageBy: varchar('pre_carriage_by', { length: 128 }),
    placeOfReceipt: varchar('place_of_receipt', { length: 128 }),
    countryOfOrigin: varchar('country_of_origin', { length: 64 })
      .default('India')
      .notNull(),
    countryFinalDestination: varchar('country_final_destination', {
      length: 64,
    }),
    vesselFlightNo: varchar('vessel_flight_no', { length: 128 }),
    portOfLoading: varchar('port_of_loading', { length: 128 }),
    portOfDischarge: varchar('port_of_discharge', { length: 128 }),
    destinationCountry: varchar('destination_country', { length: 64 }),
    termsOf: varchar('terms_of', { length: 128 }),
    paymentTerm: varchar('payment_term', { length: 255 }),
    brand: varchar('brand', { length: 128 }),
    transport: varchar('transport', { length: 128 }),
    vehicleNo: varchar('vehicle_no', { length: 64 }),
    orderRemark: text('order_remark'),

    // Specification
    specVariety: varchar('spec_variety', { length: 128 }),
    specAvgLengthMm: numeric('spec_avg_length_mm', { precision: 6, scale: 2 }),
    specMoisturePct: numeric('spec_moisture_pct', { precision: 5, scale: 2 }),
    specBrokenPct: numeric('spec_broken_pct', { precision: 5, scale: 2 }),
    specCropYear: varchar('spec_crop_year', { length: 16 }),

    millingInstructions: text('milling_instructions'),
    packagingInstructions: text('packaging_instructions'),
    dispatchSchedule: date('dispatch_schedule'),

    // Totals
    totalQuantityMt: numeric('total_quantity_mt', { precision: 12, scale: 3 })
      .default('0.000')
      .notNull(),
    totalBags: integer('total_bags').default(0).notNull(),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 })
      .default('0.00')
      .notNull(),
    allocatedInvoiceMt: numeric('allocated_invoice_mt', {
      precision: 12,
      scale: 3,
    })
      .default('0.000')
      .notNull(),

    showSignature: boolean('show_signature').default(true).notNull(),
    frozenTerms: text('frozen_terms'),

    status: varchar('status', { length: 32 }).default('PENDING').notNull(), // 'PENDING'/'OPEN'/'IN_PRODUCTION'/'COMPLETED'/'CANCELLED'
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
    uniqueIndex('uq_po_company_number').on(
      table.companyId,
      table.documentNumber,
    ),
  ],
);

export const productionOrderItems = pgTable('production_order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  productionOrderId: uuid('production_order_id')
    .notNull()
    .references(() => productionOrders.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').default(1).notNull(),
  proformaItemId: uuid('proforma_item_id').references(() => proformaItems.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  packingTypeId: uuid('packing_type_id').references(() => packingTypes.id),
  packingText: text('packing_text'),
  hsCode: varchar('hs_code', { length: 16 }),
  cropYear: varchar('crop_year', { length: 16 }),
  noOfBags: integer('no_of_bags').default(0).notNull(),
  quantityMt: numeric('quantity_mt', { precision: 12, scale: 3 }).notNull(), // Net wt (MT)
  grossWtMt: numeric('gross_wt_mt', { precision: 12, scale: 3 }),
  ratePerMt: numeric('rate_per_mt', { precision: 15, scale: 2 })
    .default('0.00')
    .notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 })
    .default('0.00')
    .notNull(),
  cgst: numeric('cgst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  sgst: numeric('sgst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  igst: numeric('igst', { precision: 15, scale: 2 }).default('0.00').notNull(),
  brokenBelow: boolean('broken_below').default(false).notNull(),
  fcl: boolean('fcl').default(false).notNull(),
  allocatedInvoiceMt: numeric('allocated_invoice_mt', {
    precision: 12,
    scale: 3,
  })
    .default('0.000')
    .notNull(),
  specifications: text('specifications'),
});

// Each selected Term & Condition on a production order is its own queryable row
export const productionTerms = pgTable('production_terms', {
  id: uuid('id').defaultRandom().primaryKey(),
  productionOrderId: uuid('production_order_id')
    .notNull()
    .references(() => productionOrders.id, { onDelete: 'cascade' }),
  termId: uuid('term_id').references(() => termsAndConditions.id),
  position: integer('position').default(0).notNull(),
  content: text('content').notNull(),
});

export type ProductionOrder = typeof productionOrders.$inferSelect;
export type NewProductionOrder = typeof productionOrders.$inferInsert;
export type ProductionOrderItem = typeof productionOrderItems.$inferSelect;
export type NewProductionOrderItem = typeof productionOrderItems.$inferInsert;
export type ProductionTerm = typeof productionTerms.$inferSelect;
export type NewProductionTerm = typeof productionTerms.$inferInsert;
