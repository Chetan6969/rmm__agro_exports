import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, recordColumns } from './columns.js';
import { companies } from './masters.js';

// ------------------------------------------------------------------ users & sessions
export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    defaultCompanyId: uuid('default_company_id').references(() => companies.id, { onDelete: 'set null' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...recordColumns(),
  },
  (t) => [uniqueIndex('users_username_uq').on(sql`lower(${t.username})`).where(sql`deleted_at is null`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    /** sha256 of the cookie token; the raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeCompanyId: uuid('active_company_id').references(() => companies.id, { onDelete: 'set null' }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

// ------------------------------------------------------------------ RBAC
/** Roles are defined once for the whole group and assigned per company. */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    /** System roles (Administrator) cannot be deleted. */
    isSystem: boolean('is_system').notNull().default(false),
    ...recordColumns(),
  },
  (t) => [uniqueIndex('roles_name_uq').on(sql`lower(${t.name})`).where(sql`deleted_at is null`)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    /** "module:action", validated against the shared catalog. */
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

/** Membership: a user belongs to a company when they hold at least one role there. */
export const userCompanyRoles = pgTable(
  'user_company_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companyId, t.roleId] }), index('ucr_company_idx').on(t.companyId)],
);

// ------------------------------------------------------------------ data sharing
export const sharingPolicies = pgTable(
  'sharing_policies',
  {
    id: id(),
    entity: text('entity').notNull(),
    sourceCompanyId: uuid('source_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    targetCompanyId: uuid('target_company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** read = target can see; write = target can also edit (never delete). */
    access: text('access', { enum: ['read', 'write'] }).notNull().default('read'),
    /** null = all records of the source company, else only these ids. */
    recordIds: uuid('record_ids').array(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Removed policies stay in the recycle bin (they grant nothing while deleted). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
    deleteReason: text('delete_reason'),
  },
  (t) => [
    uniqueIndex('sharing_uq').on(t.entity, t.sourceCompanyId, t.targetCompanyId).where(sql`deleted_at is null`),
    index('sharing_target_idx').on(t.entity, t.targetCompanyId),
  ],
);

// ------------------------------------------------------------------ per-company defaults for master forms
export const entityDefaults = pgTable(
  'entity_defaults',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.entity] })],
);

// ------------------------------------------------------------------ document numbering
export const numberSeries = pgTable(
  'number_series',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    pattern: text('pattern').notNull(),
    resetYearly: boolean('reset_yearly').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.docType] })],
);

/** One row per company/doc type/period. Incremented inside the business transaction = gap-free. */
export const numberCounters = pgTable(
  'number_counters',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    /** FY start year (e.g. 2026) or 0 when the series never resets. */
    period: integer('period').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.docType, t.period] })],
);

// ------------------------------------------------------------------ live exchange rates (group-wide)
/**
 * Market reference rates fetched from public providers, one row per currency, source and
 * rate date. The newest row per currency is what the UI shows; older rows are history.
 * Not company data, so no RLS (like the global currencies master).
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    currencyCode: text('currency_code').notNull(),
    /** Indian rupees per 1 unit of the currency. */
    rateToInr: numeric('rate_to_inr', { precision: 18, scale: 6 }).notNull(),
    /** Business date the provider published the rate for. */
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    /** 'ECB' (European Central Bank via Frankfurter) or 'fawazahmed0' (open market data). */
    source: text('source').notNull(),
    /** When this server last confirmed the rate with the provider. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('exchange_rates_code_source_date_uq').on(t.currencyCode, t.source, t.rateDate),
    // latest rate per currency: WHERE currency_code = ? ORDER BY fetched_at DESC
    index('exchange_rates_code_fetched_idx').on(t.currencyCode, t.fetchedAt),
    check('exchange_rates_positive', sql`${t.rateToInr} > 0`),
  ],
);

// ------------------------------------------------------------------ files (logos, seals, attachments)
export const files = pgTable(
  'files',
  {
    id: id(),
    /** null = group asset (company branding), else private to that company. */
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    storagePath: text('storage_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [index('files_company_idx').on(t.companyId)],
);

// ------------------------------------------------------------------ audit trail (append only)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id'),
    companyId: uuid('company_id'),
    entity: text('entity').notNull(),
    recordId: text('record_id'),
    action: text('action').notNull(),
    /** Only the fields that changed: { field: [before, after] } */
    changes: jsonb('changes').$type<Record<string, [unknown, unknown]>>(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ip: inet('ip'),
  },
  (t) => [
    index('audit_entity_idx').on(t.entity, t.recordId),
    index('audit_company_at_idx').on(t.companyId, t.at),
    index('audit_user_idx').on(t.userId),
  ],
);
