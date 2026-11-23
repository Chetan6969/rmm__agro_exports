/**
 * Receipts recorded against a commercial invoice. Received = sum of payments for an invoice;
 * pending = invoice total − received. Company-scoped and isolated by Row Level Security
 * (see rls.ts — `payments` is listed in PRIVATE_COMPANY_TABLES).
 */
import { date, index, numeric, pgTable, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { id, recordColumns } from './columns.js';
import { commercialInvoices } from './documents.js';
import { companies } from './masters.js';

export const payments = pgTable(
  'payments',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: 'restrict' }),
    commercialInvoiceId: uuid('commercial_invoice_id')
      .notNull()
      .references((): AnyPgColumn => commercialInvoices.id, { onDelete: 'cascade' }),
    paymentDate: date('payment_date').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    mode: text('mode'),
    reference: text('reference'),
    note: text('note'),
    ...recordColumns(),
  },
  (t) => [index('payments_company_idx').on(t.companyId), index('payments_invoice_idx').on(t.commercialInvoiceId)],
);
