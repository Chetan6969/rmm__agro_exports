/**
 * Generic master-data engine. Works for every EntityDef in the shared registry, so
 * adding a master needs no new service code.
 */
import { buildEntitySchema, getEntity, type EntityDef } from '@rmm/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { files, masterTables, type AnyTable } from '../../db/schema/index.js';
import { companiesForUser } from '../../core/access.js';
import { audit } from '../../core/audit.js';
import { requireCompany, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';

export function resolveEntity(key: string): { def: EntityDef; table: AnyTable } {
  const def = getEntity(key);
  if (!def) throw notFound(`Unknown master "${key}"`);
  return { def, table: masterTables[def.key] };
}

const moduleKey = (def: EntityDef) => `master.${def.key}`;

export interface ListQuery {
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  /** all | active | inactive */
  status?: string;
  /** company masters: all | own | shared */
  ownership?: string;
}

type Row = Record<string, unknown>;

async function scopeConditions(tx: Tx, ctx: RequestContext, def: EntityDef, table: AnyTable): Promise<SQL[]> {
  const conds: SQL[] = [isNull(table.deletedAt)];
  if (def.scope === 'company') requireCompany(ctx);
  if (def.scope === 'group' && !ctx.isSuperAdmin) {
    const mine = await companiesForUser(tx, ctx.userId, false);
    conds.push(mine.length ? inArray(table.id, mine.map((c) => c.id)) : sql`false`);
  }
  return conds;
}

/** Adds `<field>Label` for every ref field, plus ownership info for company masters. */
async function decorate(tx: Tx, ctx: RequestContext, def: EntityDef, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows;
  for (const f of def.fields.filter((x) => x.type === 'ref')) {
    const ids = [...new Set(rows.map((r) => r[f.name]).filter(Boolean))] as string[];
    if (!ids.length) continue;
    const target = resolveEntity(f.ref!);
    const labels = await tx
      .select({ id: target.table.id, label: target.table[target.def.displayField] })
      .from(target.table)
      .where(inArray(target.table.id, ids));
    const map = new Map(labels.map((l) => [l.id as string, l.label as string]));
    for (const r of rows) if (r[f.name]) r[`${f.name}Label`] = map.get(r[f.name] as string) ?? '(not accessible)';
  }
  if (def.scope === 'company') {
    const owners = [...new Set(rows.map((r) => r.companyId as string))];
    const co = masterTables.companies;
    const names = await tx.select({ id: co.id, code: co.code }).from(co).where(inArray(co.id, owners));
    const map = new Map(names.map((n) => [n.id as string, n.code as string]));
    for (const r of rows) {
      r._ownerCode = map.get(r.companyId as string) ?? '';
      r._shared = r.companyId !== ctx.companyId;
    }
  }
  return rows;
}

export async function listRecords(tx: Tx, ctx: RequestContext, key: string, q: ListQuery) {
  const { def, table } = resolveEntity(key);
  requirePerm(ctx, moduleKey(def), 'view');
  const conds = await scopeConditions(tx, ctx, def, table);

  const search = q.search?.trim();
  if (search) {
    const cols = def.fields.filter((f) => f.search).map((f) => ilike(table[f.name], `%${search.replace(/[%_\\]/g, '\\$&')}%`));
    if (cols.length) conds.push(or(...cols)!);
  }
  if (q.status === 'active') conds.push(eq(table.isActive, true));
  if (q.status === 'inactive') conds.push(eq(table.isActive, false));
  if (def.scope === 'company' && q.ownership === 'own') conds.push(eq(table.companyId, ctx.companyId!));
  if (def.scope === 'company' && q.ownership === 'shared') conds.push(ne(table.companyId, ctx.companyId!));

  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 500);
  const page = Math.max(Number(q.page) || 1, 1);
  const sortable = new Set(['createdAt', 'updatedAt', ...def.fields.filter((f) => f.type !== 'textarea').map((f) => f.name)]);
  const sortCol = table[q.sort && sortable.has(q.sort) ? q.sort : def.displayField];
  const where = and(...conds);

  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(table).where(where);
  const rows = (await tx
    .select()
    .from(table)
    .where(where)
    .orderBy(q.dir === 'desc' ? desc(sortCol) : asc(sortCol), asc(table.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)) as Row[];
  return { rows: await decorate(tx, ctx, def, rows), total, page, pageSize };
}

async function loadVisible(tx: Tx, ctx: RequestContext, def: EntityDef, table: AnyTable, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const conds = await scopeConditions(tx, ctx, def, table);
  const [row] = (await tx.select().from(table).where(and(eq(table.id, id), ...conds))) as Row[];
  if (!row) throw notFound();
  return row;
}

export async function getRecord(tx: Tx, ctx: RequestContext, key: string, id: string) {
  const { def, table } = resolveEntity(key);
  requirePerm(ctx, moduleKey(def), 'view');
  const row = await loadVisible(tx, ctx, def, table, id);
  return (await decorate(tx, ctx, def, [row]))[0];
}

/** Ref/file values must point at records the caller can actually see (RLS applies). */
async function checkRefs(tx: Tx, def: EntityDef, values: Row) {
  for (const f of def.fields.filter((x) => x.type === 'file')) {
    const v = values[f.name];
    if (!v) continue;
    const [hit] = await tx.select({ id: files.id, mime: files.mimeType }).from(files).where(eq(files.id, v as string));
    if (!hit) throw badRequest(`${f.label}: uploaded file not found`, { [f.name]: 'Not found' });
    if (!hit.mime.startsWith('image/')) throw badRequest(`${f.label}: must be an image`, { [f.name]: 'Image required' });
  }
  for (const f of def.fields.filter((x) => x.type === 'ref')) {
    const v = values[f.name];
    if (!v) continue;
    const target = resolveEntity(f.ref!);
    const [hit] = await tx
      .select({ id: target.table.id })
      .from(target.table)
      .where(and(eq(target.table.id, v as string), isNull(target.table.deletedAt)));
    if (!hit) throw badRequest(`${f.label}: selected record is not available`, { [f.name]: 'Not available' });
  }
}

export async function createRecord(tx: Tx, ctx: RequestContext, key: string, body: unknown) {
  const { def, table } = resolveEntity(key);
  requirePerm(ctx, moduleKey(def), 'create');
  if (def.scope === 'group' && !ctx.isSuperAdmin) throw forbidden('Only a super admin can create companies');
  const values = buildEntitySchema(def, 'create').parse(body ?? {}) as Row;
  for (const f of def.fields) {
    if ((values[f.name] === undefined || values[f.name] === null) && f.default !== undefined) values[f.name] = f.default;
  }
  await checkRefs(tx, def, values);
  if (def.scope === 'company') values.companyId = requireCompany(ctx);
  values.createdBy = ctx.userId;
  values.updatedBy = ctx.userId;
  const [row] = (await tx.insert(table).values(values).returning()) as Row[];
  await audit(tx, ctx, { entity: def.key, recordId: row.id as string, action: 'create', after: row });
  return (await decorate(tx, ctx, def, [row]))[0];
}

export async function updateRecord(tx: Tx, ctx: RequestContext, key: string, id: string, body: unknown) {
  const { def, table } = resolveEntity(key);
  requirePerm(ctx, moduleKey(def), 'edit');
  const { version, ...rest } = (body ?? {}) as Row;
  if (typeof version !== 'number') throw badRequest('version is required for updates');
  const values = buildEntitySchema(def, 'update').parse(rest) as Row;
  const before = await loadVisible(tx, ctx, def, table, id);
  await checkRefs(tx, def, values);

  const updated = (await tx
    .update(table)
    .set({ ...values, version: sql`${table.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(table.id, id), eq(table.version, version), isNull(table.deletedAt)))
    .returning()) as Row[];

  if (!updated.length) {
    if (before.version !== version) throw conflict('This record was changed by another user. Reload and try again.');
    throw forbidden('This record is shared with your company as read-only');
  }
  await audit(tx, ctx, {
    entity: def.key,
    recordId: id,
    action: 'update',
    before,
    after: updated[0],
    companyId: (before.companyId as string) ?? ctx.companyId,
  });
  return (await decorate(tx, ctx, def, updated))[0];
}

export async function deleteRecord(tx: Tx, ctx: RequestContext, key: string, id: string, reason: string) {
  const { def, table } = resolveEntity(key);
  requirePerm(ctx, moduleKey(def), 'delete');
  if (def.scope === 'group' && !ctx.isSuperAdmin) throw forbidden('Only a super admin can delete companies');
  if (!reason?.trim()) throw badRequest('A reason is required to delete', { reason: 'Required' });
  const before = await loadVisible(tx, ctx, def, table, id);
  if (def.scope === 'company' && before.companyId !== ctx.companyId) {
    throw forbidden('Only the owning company can delete a shared record');
  }
  await tx
    .update(table)
    .set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason.trim(), isActive: false })
    .where(eq(table.id, id));
  await audit(tx, ctx, { entity: def.key, recordId: id, action: 'delete', meta: { reason: reason.trim() } });
  return { ok: true };
}

/** Compact id/label list for dropdowns. Any signed-in member may look up labels. */
export async function lookup(tx: Tx, ctx: RequestContext, key: string, q: { q?: string; ids?: string; limit?: number }) {
  const { def, table } = resolveEntity(key);
  const conds = await scopeConditions(tx, ctx, def, table);
  const ids = q.ids?.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (ids?.length) conds.push(inArray(table.id, ids));
  else conds.push(eq(table.isActive, true));
  const term = q.q?.trim();
  if (term) {
    const cols = def.fields.filter((f) => f.search).map((f) => ilike(table[f.name], `%${term.replace(/[%_\\]/g, '\\$&')}%`));
    if (cols.length) conds.push(or(...cols)!);
  }
  const hasCode = def.fields.some((f) => f.name === 'code') && def.displayField !== 'code';
  const rows = await tx
    .select({
      id: table.id,
      label: table[def.displayField],
      ...(hasCode ? { sub: table.code } : {}),
    })
    .from(table)
    .where(and(...conds))
    .orderBy(asc(table[def.displayField]))
    .limit(Math.min(Number(q.limit) || 20, 100));
  return rows;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // neutralise spreadsheet formula injection, but keep plain numbers (e.g. -5.00) numeric
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCsv(tx: Tx, ctx: RequestContext, key: string, q: ListQuery) {
  const { def } = resolveEntity(key);
  requirePerm(ctx, moduleKey(def), 'export');
  const all: Row[] = [];
  for (let page = 1; ; page++) {
    const res = await listRecords(tx, ctx, key, { ...q, page, pageSize: 500 });
    all.push(...res.rows);
    if (all.length >= res.total || !res.rows.length) break;
  }
  const fields = def.fields.filter((f) => f.type !== 'file');
  const header = [...fields.map((f) => f.label), ...(def.scope === 'company' ? ['Owner company'] : [])];
  const lines = [header.map(csvCell).join(',')];
  for (const r of all) {
    const cells = fields.map((f) => (f.type === 'ref' ? r[`${f.name}Label`] : f.type === 'boolean' ? (r[f.name] ? 'Yes' : 'No') : r[f.name]));
    if (def.scope === 'company') cells.push(r._ownerCode);
    lines.push(cells.map(csvCell).join(','));
  }
  await audit(tx, ctx, { entity: def.key, action: 'export', meta: { rows: all.length } });
  return { filename: `${def.key}-${new Date().toISOString().slice(0, 10)}.csv`, body: `﻿${lines.join('\r\n')}` };
}
