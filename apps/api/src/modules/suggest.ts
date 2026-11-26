/**
 * "Typed before" suggestions: when a box is focused the form offers the values previously entered in
 * that same field (newest first), so dates, references, marks etc. can be re-picked instead of re-typed.
 *
 * Safety: the column is looked up in the shared registry — never taken from the request — the module's
 * view permission is required, and the query runs under RLS, so a user only sees values from records
 * they could already open.
 */
import { getDoc, getEntity, type FieldDef } from '@rmm/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../db/client.js';
import { docTables, masterTables, type AnyTable } from '../db/schema/index.js';
import { inTenantTx, requireCtx, requirePerm, type RequestContext } from '../core/context.js';

const SUGGESTABLE = new Set(['text', 'textarea', 'email', 'date', 'decimal', 'integer']);
const LIMIT = 12;

/** Fields a box may ask suggestions for (unique values and document numbers would only invite duplicates). */
const suggestable = (f: FieldDef | undefined) => !!f && SUGGESTABLE.has(f.type) && !f.unique && f.name !== 'documentNumber' && !f.template;

export async function suggestValues(tx: Tx, ctx: RequestContext, key: string, field: string, part: string, search: string): Promise<string[]> {
  const q = search.trim().slice(0, 100);
  let fields: FieldDef[];
  let table: AnyTable;
  let parent: AnyTable | null = null;
  let module: string;
  const doc = getDoc(key);
  const ent = doc ? undefined : getEntity(key);
  if (doc) {
    const dt = docTables[doc.key];
    module = doc.module;
    if (part === 'lines') {
      if (!dt.lines) return [];
      fields = doc.lines;
      table = dt.lines;
      parent = dt.header;
    } else {
      fields = doc.header;
      table = dt.header;
    }
  } else if (ent) {
    module = `master.${ent.key}`;
    fields = ent.fields;
    table = masterTables[ent.key];
  } else {
    return [];
  }

  const f = fields.find((x) => x.name === field);
  if (!suggestable(f)) return [];
  requirePerm(ctx, module, 'view');

  const col = table[f!.name];
  const live = parent ? parent : table; // line rows live as long as their document
  const conds: (SQL | undefined)[] = [sql`${col} is not null`, sql`${col}::text <> ''`, isNull(live.deletedAt)];
  if (q) conds.push(sql`${col}::text ilike ${`%${q.replace(/[%_\\]/g, '\\$&')}%`}`);

  const base = tx.select({ v: sql<string>`${col}::text` }).from(table);
  const joined = parent ? base.innerJoin(parent, eq(table.documentId, parent.id)) : base;
  const rows = await joined
    .where(and(...conds))
    .groupBy(col)
    .orderBy(sql`max(${live.updatedAt}) desc`)
    .limit(LIMIT);
  return rows.map((r) => r.v);
}

export async function suggestRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { key?: string; field?: string; part?: string; q?: string } }>('/suggest', async (req) => {
    const ctx = requireCtx(req);
    const { key = '', field = '', part = 'header', q = '' } = req.query;
    return inTenantTx(ctx, (tx) => suggestValues(tx, ctx, key, field, part, q));
  });
}
