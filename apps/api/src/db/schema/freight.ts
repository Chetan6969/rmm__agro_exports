/**
 * Freight quotations by email.
 *  mail_accounts       each user's own mailbox (app password stored encrypted); not company data
 *  freight_enquiries   one rate request (route, containers, cargo) sent to several carriers
 *  freight_threads     the conversation with one contact for one enquiry
 *  freight_messages    every mail in a thread, sent or received
 *  freight_quotes      rates offered in a thread (each negotiation round is a new revision)
 *  freight_mail_index  Message-ID → company/thread, so replies are matched without scanning
 */
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { id, recordColumns } from './columns.js';
import { users } from './core.js';
import { companies } from './masters.js';

const company = () =>
  uuid('company_id')
    .notNull()
    .references((): AnyPgColumn => companies.id, { onDelete: 'restrict' });

export const mailAccounts = pgTable(
  'mail_accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    displayName: text('display_name'),
    provider: text('provider').notNull().default('other'),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull(),
    smtpSecure: boolean('smtp_secure').notNull(),
    imapHost: text('imap_host').notNull(),
    imapPort: integer('imap_port').notNull(),
    imapSecure: boolean('imap_secure').notNull(),
    username: text('username').notNull(),
    /** AES-256-GCM with MAIL_SECRET_KEY; never returned by the API. */
    passwordEnc: text('password_enc').notNull(),
    /** unverified | ok | error */
    status: text('status').notNull().default('unverified'),
    lastError: text('last_error'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    imapUidValidity: text('imap_uid_validity'),
    imapLastUid: integer('imap_last_uid').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mail_accounts_user_uq').on(t.userId)],
);

export const freightEnquiries = pgTable(
  'freight_enquiries',
  {
    id: id(),
    companyId: company(),
    number: text('number').notNull(),
    enquiryDate: date('enquiry_date', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('OPEN'),
    shipmentId: uuid('shipment_id'),
    proformaInvoiceId: uuid('proforma_invoice_id'),
    portOfLoading: text('port_of_loading').notNull(),
    portOfDischarge: text('port_of_discharge').notNull(),
    containerType: text('container_type').notNull(),
    containerCount: integer('container_count').notNull(),
    commodity: text('commodity'),
    grossWeightMt: numeric('gross_weight_mt', { precision: 12, scale: 3 }),
    readyDate: date('ready_date', { mode: 'string' }),
    freeDaysWanted: integer('free_days_wanted'),
    incoterm: text('incoterm'),
    replyBy: date('reply_by', { mode: 'string' }),
    /** Automatic reminder to contacts who have not replied after this many hours (0 = off). */
    reminderHours: integer('reminder_hours').notNull().default(48),
    notes: text('notes'),
    awardedThreadId: uuid('awarded_thread_id'),
    ...recordColumns(),
  },
  (t) => [uniqueIndex('freight_enquiries_number_uq').on(t.companyId, t.number), index('freight_enquiries_company_idx').on(t.companyId, t.enquiryDate)],
);

export const freightThreads = pgTable(
  'freight_threads',
  {
    id: id(),
    companyId: company(),
    enquiryId: uuid('enquiry_id')
      .notNull()
      .references(() => freightEnquiries.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email').notNull(),
    carrier: text('carrier').notNull(),
    /** User whose mailbox sent the first mail (replies arrive there). */
    ownerUserId: uuid('owner_user_id').notNull(),
    status: text('status').notNull().default('SENT'),
    remindersSent: integer('reminders_sent').notNull().default(0),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    unread: integer('unread').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('freight_threads_enquiry_idx').on(t.enquiryId)],
);

export const freightMessages = pgTable(
  'freight_messages',
  {
    id: id(),
    companyId: company(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => freightThreads.id, { onDelete: 'cascade' }),
    /** out = sent from the ERP, in = received reply */
    direction: text('direction').notNull(),
    messageId: text('message_id').notNull(),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    /** Received HTML is kept as sent; the web shows it in a sandbox without scripts. */
    bodyHtml: text('body_html'),
    attachments: jsonb('attachments').$type<{ fileId: string; name: string; size: number; mime: string }[]>(),
    sentByUserId: uuid('sent_by_user_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('freight_messages_thread_idx').on(t.threadId, t.sentAt), uniqueIndex('freight_messages_mid_uq').on(t.companyId, t.messageId)],
);

export const freightQuotes = pgTable(
  'freight_quotes',
  {
    id: id(),
    companyId: company(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => freightThreads.id, { onDelete: 'cascade' }),
    enquiryId: uuid('enquiry_id').notNull(),
    /** The reply it was read from (null = typed in). */
    messageId: uuid('message_id'),
    revision: integer('revision').notNull(),
    currency: text('currency').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    perContainer: boolean('per_container').notNull().default(true),
    surcharges: numeric('surcharges', { precision: 14, scale: 2 }),
    freeDays: integer('free_days'),
    transitDays: integer('transit_days'),
    validUntil: date('valid_until', { mode: 'string' }),
    notes: text('notes'),
    /** true = read automatically from a reply (shown as "check this"); false = typed or confirmed by a user. */
    auto: boolean('auto').notNull().default(false),
    /** Reply lines the automatic values came from. */
    evidence: jsonb('evidence').$type<string[]>(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('freight_quotes_thread_idx').on(t.threadId, t.revision)],
);

/** Not company-scoped on purpose: the mailbox sync must find the company of a reply first. */
export const freightMailIndex = pgTable('freight_mail_index', {
  messageId: text('message_id').primaryKey(),
  companyId: uuid('company_id').notNull(),
  threadId: uuid('thread_id').notNull(),
});
