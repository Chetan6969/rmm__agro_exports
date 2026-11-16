/**
 * Builds the sales document tables (header, lines, terms, containers) from the shared
 * document registry, the same way masters are built from the entity registry.
 * Every table carries company_id and is isolated by Row Level Security (see rls.ts).
 */
import { DOC_LIST, type DocDef, type DocKey } from '@rmm/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgColumnBuilderBase,
} from 'drizzle-orm/pg-core';
import { CONTAINER_FIELDS } from '@rmm/shared';
import { id, recordColumns } from './columns.js';
import { column, masterTables, snake, type AnyTable } from './masters.js';

export interface DocTables {
  header: AnyTable;
  lines: AnyTable;
  terms: AnyTable;
  containers: AnyTable | null;
}

export const docTables = {} as Record<DocKey, DocTables>;

const companyColumn = () =>
  uuid('company_id')
    .notNull()
    .references((): AnyPgColumn => masterTables.companies.id, { onDelete: 'restrict' });

function headerTable(def: DocDef): AnyTable {
  const cols: Record<string, PgColumnBuilderBase> = { id: id(), companyId: companyColumn() };
  for (const f of def.header) {
    if (f.name === 'documentNumber') cols[f.name] = text('document_number').notNull();
    else if (f.type === 'doc') cols[f.name] = uuid(snake(f.name)).references((): AnyPgColumn => docTables[f.ref as DocKey].header.id, { onDelete: 'restrict' });
    else cols[f.name] = column(f);
  }
  for (const t of def.totals) {
    if (!cols[t.name]) cols[t.name] = numeric(snake(t.name), { precision: 18, scale: t.scale }).notNull().default('0');
  }
  cols.amountInWords = text('amount_in_words');
  Object.assign(cols, recordColumns());
  return pgTable(def.table, cols, (t) => [
    uniqueIndex(`${def.table}_number_uq`).on(t.companyId, t.documentNumber).where(sql`deleted_at is null`),
    index(`${def.table}_company_date_idx`).on(t.companyId, t.documentDate),
    ...def.header.filter((f) => f.type === 'ref' || f.type === 'doc').map((f) => index(`${def.table}_${snake(f.name)}_idx`).on(t[f.name])),
  ]) as AnyTable;
}

function childTable(name: string, parent: AnyTable, extra: Record<string, PgColumnBuilderBase>): AnyTable {
  return pgTable(
    name,
    {
      id: id(),
      companyId: companyColumn(),
      documentId: uuid('document_id')
        .notNull()
        .references((): AnyPgColumn => parent.id, { onDelete: 'cascade' }),
      position: integer('position').notNull(),
      ...extra,
    },
    (t) => [index(`${name}_document_idx`).on(t.documentId, t.position)],
  ) as AnyTable;
}

for (const def of DOC_LIST) {
  const header = headerTable(def);
  const lineCols: Record<string, PgColumnBuilderBase> = {};
  for (const f of def.lines) lineCols[f.name] = column(f);
  lineCols.amount = numeric('amount', { precision: 15, scale: 2 }).notNull().default('0');
  /** The parent document's line this one was generated from (balance tracking). */
  lineCols.sourceLineId = uuid('source_line_id');
  const containerCols: Record<string, PgColumnBuilderBase> = {};
  for (const f of CONTAINER_FIELDS) containerCols[f.name] = column(f);
  docTables[def.key] = {
    header,
    lines: childTable(def.linesTable, header, lineCols),
    terms: childTable(def.termsTable, header, {
      tcTemplateId: uuid('tc_template_id').references((): AnyPgColumn => masterTables.tcTemplates.id, { onDelete: 'set null' }),
      content: text('content').notNull(),
    }),
    containers: def.containers ? childTable(`${def.table.replace(/s$/, '')}_containers`, header, containerCols) : null,
  };
}

/** Every company-scoped document table (RLS policies are applied to each). */
export const DOCUMENT_TABLE_NAMES = DOC_LIST.flatMap((d) => [d.table, d.linesTable, d.termsTable, ...(d.containers ? [`${d.table.replace(/s$/, '')}_containers`] : [])]);

// Named exports so drizzle-kit discovers the tables.
export const proformaInvoices = docTables.proformaInvoices.header;
export const proformaInvoiceLines = docTables.proformaInvoices.lines;
export const proformaInvoiceTerms = docTables.proformaInvoices.terms;
export const productionOrders = docTables.productionOrders.header;
export const productionOrderLines = docTables.productionOrders.lines;
export const productionOrderTerms = docTables.productionOrders.terms;
export const commercialInvoices = docTables.commercialInvoices.header;
export const commercialInvoiceLines = docTables.commercialInvoices.lines;
export const commercialInvoiceTerms = docTables.commercialInvoices.terms;
export const commercialInvoiceContainers = docTables.commercialInvoices.containers!;
