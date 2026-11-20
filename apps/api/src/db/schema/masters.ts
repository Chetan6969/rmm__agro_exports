/**
 * Builds a Drizzle table for every master in the shared ENTITY registry.
 * Columns are camelCase in code and snake_case in PostgreSQL.
 */
import { ENTITY_LIST, type EntityDef, type FieldDef } from '@rmm/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgColumnBuilderBase,
  type PgTableWithColumns,
} from 'drizzle-orm/pg-core';
import { id, recordColumns } from './columns.js';

export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTable = PgTableWithColumns<any>;

export const masterTables: Record<string, AnyTable> = {};

export function column(f: FieldDef): PgColumnBuilderBase {
  const name = snake(f.name);
  let c;
  switch (f.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'select':
      c = text(name);
      break;
    case 'integer':
      c = integer(name);
      break;
    case 'decimal':
      c = numeric(name, { precision: f.precision ?? 18, scale: f.scale ?? 4 });
      break;
    case 'boolean':
      c = boolean(name);
      break;
    case 'date':
      c = date(name);
      break;
    case 'file':
      c = uuid(name);
      break;
    case 'doc':
      c = uuid(name);
      break;
    case 'ref':
      c = uuid(name).references((): AnyPgColumn => masterTables[f.ref!].id, { onDelete: 'restrict' });
      break;
  }
  if (f.type === 'boolean') {
    c = (c as ReturnType<typeof boolean>).notNull().default(Boolean(f.default ?? false));
  } else if (f.required) {
    c = (c as ReturnType<typeof text>).notNull();
  }
  return c;
}

function buildTable(def: EntityDef): AnyTable {
  const cols: Record<string, PgColumnBuilderBase> = { id: id() };
  if (def.scope === 'company') {
    cols.companyId = uuid('company_id')
      .notNull()
      .references((): AnyPgColumn => masterTables.companies.id, { onDelete: 'restrict' });
  }
  for (const f of def.fields) cols[f.name] = column(f);
  Object.assign(cols, recordColumns());

  return pgTable(def.table, cols, (t) => {
    const extras = [];
    for (const f of def.fields) {
      if (f.unique) {
        const name = `${def.table}_${snake(f.name)}_uq`;
        const ix = def.scope === 'company' ? uniqueIndex(name).on(t.companyId, t[f.name]) : uniqueIndex(name).on(t[f.name]);
        extras.push(ix.where(sql`deleted_at is null`));
      }
      if (f.type === 'ref') extras.push(index(`${def.table}_${snake(f.name)}_idx`).on(t[f.name]));
    }
    if (def.scope === 'company') extras.push(index(`${def.table}_company_idx`).on(t.companyId));
    return extras;
  }) as AnyTable;
}

// companies first: every company-scoped table references it.
const ordered = [...(ENTITY_LIST as readonly EntityDef[])].sort((a, b) =>
  a.key === 'companies' ? -1 : b.key === 'companies' ? 1 : 0,
);
for (const def of ordered) masterTables[def.key] = buildTable(def);

// Named exports so drizzle-kit discovers the tables.
export const companies = masterTables.companies;
export const bankAccounts = masterTables.bankAccounts;
export const customers = masterTables.customers;
export const suppliers = masterTables.suppliers;
export const serviceProviders = masterTables.serviceProviders;
export const products = masterTables.products;
export const packingTypes = masterTables.packingTypes;
export const units = masterTables.units;
export const countries = masterTables.countries;
export const ports = masterTables.ports;
export const shippingLines = masterTables.shippingLines;
export const containerTypes = masterTables.containerTypes;
export const currencies = masterTables.currencies;
export const paymentTerms = masterTables.paymentTerms;
export const tcTemplates = masterTables.tcTemplates;
export const certificateTemplates = masterTables.certificateTemplates;
