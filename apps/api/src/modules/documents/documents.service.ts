/**
 * Sales documents engine: Proforma Invoice → Production Order → Commercial Invoice.
 *
 * Works from the shared DocDef registry. Totals are always recomputed here with exact
 * decimals (the client's figures are never trusted), numbers come from Document numbering,
 * quantities generated against a parent document can never exceed the parent's balance,
 * and every change is written to the audit log in the same transaction.
 */
import {
  amountInWords,
  buildEntitySchema,
  businessDate,
  CANCELLED,
  childDocs,
  cmp,
  computeTotals,
  CONTAINER_FIELDS,
  DOC_LIST,
  documentValue,
  getDoc,
  getEntity,
  inheritedFields,
  isPositive,
  lineAmount,
  mul,
  PI_REPORT_FIELDS,
  round,
  sub,
  type DocDef,
  type DocKey,
  type EntityDef,
  type FieldDef,
} from '@rmm/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../../db/client.js';
import { docTables, masterTables, type DocTables } from '../../db/schema/index.js';
import { audit } from '../../core/audit.js';
import { can, requireCompany, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { allocateNumber } from '../numbering.js';

type Row = Record<string, unknown>;
type Action = 'view' | 'create' | 'edit' | 'delete' | 'print' | 'export';

export function resolveDoc(key: string): { def: DocDef; t: DocTables } {
  const def = getDoc(key);
  if (!def) throw notFound(`Unknown document type "${key}"`, 'Open the screen from the Sales menu or with Ctrl+K.');
  return { def, t: docTables[def.key] };
}

const allow = (ctx: RequestContext, def: DocDef, action: Action) => {
  requireCompany(ctx);
  requirePerm(ctx, def.module, action);
};

const asEntity = (key: string, fields: FieldDef[]) => ({ key, fields }) as unknown as EntityDef;
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

// ------------------------------------------------------------------ validation
function payloadSchema(def: DocDef) {
  const header = buildEntitySchema(asEntity(def.key, def.header), 'create');
  const line = buildEntitySchema(asEntity(`${def.key}.lines`, def.lines), 'create').extend({
    sourceLineId: z.uuid().nullable().optional(),
  });
  const term = z.object({
    tcTemplateId: z.uuid().nullable().optional(),
    content: z.string().trim().min(1, 'Term text is empty').max(4000),
  });
  const container = buildEntitySchema(asEntity(`${def.key}.containers`, CONTAINER_FIELDS), 'create');
  return z.object({
    header,
    lines: z.array(line).min(1, 'Add at least one product line').max(200),
    terms: z.array(term).max(100).default([]),
    containers: z.array(container).max(200).default([]),
    version: z.number().int().optional(),
  });
}

/** Turns the flat request body { ...header, lines, terms, containers, version } into parts. */
function parsePayload(def: DocDef, body: unknown) {
  const b = (body ?? {}) as Row;
  const { lines, terms, containers, version, ...header } = b;
  const parsed = payloadSchema(def).parse({ header, lines: lines ?? [], terms: terms ?? [], containers: containers ?? [], version });
  for (const f of def.header) {
    if ((parsed.header[f.name] === undefined || parsed.header[f.name] === null) && f.default !== undefined) parsed.header[f.name] = f.default;
  }
  for (const l of parsed.lines as Row[]) {
    for (const f of def.lines) if ((l[f.name] === undefined || l[f.name] === null) && f.default !== undefined) l[f.name] = f.default;
  }
  if (!def.containers) parsed.containers = [];
  return parsed as { header: Row; lines: Row[]; terms: { tcTemplateId?: string | null; content: string }[]; containers: Row[]; version?: number };
}

/** Every referenced master must exist and be visible to this company (RLS applies). */
async function checkRefs(tx: Tx, fields: FieldDef[], rows: Row[], where: string) {
  for (const f of fields.filter((x) => x.type === 'ref')) {
    const ids = [...new Set(rows.map((r) => r[f.name]).filter(isUuid))];
    if (!ids.length) continue;
    const target = masterTables[f.ref!];
    const hits = await tx.select({ id: target.id }).from(target).where(and(inArray(target.id, ids), isNull(target.deletedAt)));
    if (hits.length !== ids.length) {
      throw badRequest(`${where}${f.label}: the selected record is not available`, {
        hint: `It may have been deleted or not shared with your company. Pick another ${f.label.toLowerCase()} from the list.`,
        fields: { [f.name]: 'Not available' },
      });
    }
  }
}

// ------------------------------------------------------------------ labels
async function refLabels(tx: Tx, fields: FieldDef[], rows: Row[]) {
  for (const f of fields) {
    if (f.type !== 'ref' && f.type !== 'doc') continue;
    const ids = [...new Set(rows.map((r) => r[f.name]).filter(isUuid))];
    if (!ids.length) continue;
    let pairs: { id: unknown; label: unknown }[];
    if (f.type === 'doc') {
      const h = docTables[f.ref as DocKey].header;
      pairs = await tx.select({ id: h.id, label: h.documentNumber }).from(h).where(inArray(h.id, ids));
    } else {
      const ent = getEntity(f.ref!)!;
      const t = masterTables[ent.key];
      pairs = await tx.select({ id: t.id, label: t[ent.displayField] }).from(t).where(inArray(t.id, ids));
    }
    const map = new Map(pairs.map((p) => [p.id as string, p.label as string]));
    for (const r of rows) if (r[f.name]) r[`${f.name}Label`] = map.get(r[f.name] as string) ?? '(not accessible)';
  }
  return rows;
}

// ------------------------------------------------------------------ balances
/** Quantity already generated against `parentId` by active child documents (optionally excluding one). */
async function allocatedQty(tx: Tx, child: DocDef, parentId: string, excludeId?: string): Promise<string> {
  const h = docTables[child.key].header;
  const conds: SQL[] = [eq(h[child.parent!.field], parentId), isNull(h.deletedAt), ne(h.status, CANCELLED)];
  if (excludeId) conds.push(ne(h.id, excludeId));
  const [r] = await tx.select({ q: sql<string>`coalesce(sum(${h.totalQuantityMt}), 0)::text` }).from(h).where(and(...conds));
  return round(r.q, 3);
}

/** Quantity already generated against each parent line (by sourceLineId). */
async function allocatedByLine(tx: Tx, child: DocDef, parentId: string): Promise<Map<string, string>> {
  const { header: h, lines: l } = docTables[child.key];
  const rows = await tx
    .select({ source: l.sourceLineId, q: sql<string>`sum(${l.quantityMt})::text` })
    .from(l)
    .innerJoin(h, eq(l.documentId, h.id))
    .where(and(eq(h[child.parent!.field], parentId), isNull(h.deletedAt), ne(h.status, CANCELLED)))
    .groupBy(l.sourceLineId);
  return new Map(rows.filter((r) => r.source).map((r) => [r.source as string, round(r.q, 3)]));
}

async function loadParent(tx: Tx, def: DocDef, header: Row, lock: boolean): Promise<Row | null> {
  const field = def.parent?.field;
  const parentId = field ? header[field] : null;
  if (!def.parent || !isUuid(parentId)) return null;
  const pt = docTables[def.parent.doc].header;
  const q = tx.select().from(pt).where(and(eq(pt.id, parentId), isNull(pt.deletedAt)));
  const [parent] = (await (lock ? q.for('update') : q)) as Row[];
  const pdef = resolveDoc(def.parent.doc).def;
  if (!parent) {
    throw badRequest(`The selected ${pdef.label.toLowerCase()} was not found`, {
      hint: `It may have been deleted. Pick another ${pdef.label.toLowerCase()} or clear the field.`,
      fields: { [def.parent.field]: 'Not found' },
    });
  }
  if (parent.status === CANCELLED) {
    throw badRequest(`${pdef.label} ${parent.documentNumber} is cancelled`, {
      hint: `Nothing can be generated against a cancelled ${pdef.label.toLowerCase()}. Pick another one or change its status first.`,
      fields: { [def.parent.field]: 'Cancelled' },
    });
  }
  return parent;
}

/** A child's quantity may never exceed what is left on its parent document. */
async function checkParentBalance(tx: Tx, def: DocDef, header: Row, totalQty: string, selfId?: string) {
  if (header.status === CANCELLED) return;
  const parent = await loadParent(tx, def, header, true);
  if (!parent) return;
  const pdef = resolveDoc(def.parent!.doc).def;
  const used = await allocatedQty(tx, def, parent.id as string, selfId);
  const remaining = sub(parent.totalQuantityMt as string, used, 3);
  if (cmp(totalQty, remaining) > 0) {
    throw badRequest(`Quantity ${totalQty} MT is more than the ${remaining} MT left on ${pdef.label.toLowerCase()} ${parent.documentNumber}`, {
      hint: `${parent.documentNumber} has ${round(parent.totalQuantityMt as string, 3)} MT, of which ${used} MT is already on other ${def.plural.toLowerCase()}. Reduce the line quantities, or increase the ${pdef.label.toLowerCase()} first.`,
    });
  }
}

/** A parent may not shrink below (or be cancelled under) what its children already use. */
async function checkChildrenFit(tx: Tx, def: DocDef, id: string, totalQty: string, status: unknown) {
  for (const child of childDocs(def.key)) {
    const used = await allocatedQty(tx, child, id);
    if (!isPositive(used)) continue;
    if (status === CANCELLED) {
      throw badRequest(`This ${def.label.toLowerCase()} still has active ${child.plural.toLowerCase()}`, {
        hint: `Cancel or delete its ${child.plural.toLowerCase()} first (they use ${used} MT), then cancel this one.`,
        fields: { status: 'Has active documents' },
      });
    }
    if (cmp(totalQty, used) < 0) {
      throw badRequest(`Total quantity ${totalQty} MT is below the ${used} MT already used by ${child.plural.toLowerCase()}`, {
        hint: `Reduce or cancel those ${child.plural.toLowerCase()} first, or keep at least ${used} MT here.`,
      });
    }
  }
}

// ------------------------------------------------------------------ helpers for writes
async function currencyWords(tx: Tx, currencyId: unknown, amount: string): Promise<string | null> {
  if (!isUuid(currencyId)) return null;
  const c = masterTables.currencies;
  const [cur] = await tx.select({ code: c.code, decimals: c.decimals, subunitName: c.subunitName }).from(c).where(eq(c.id, currencyId));
  if (!cur) return null;
  return amountInWords(amount, { code: cur.code as string, decimals: cur.decimals as number | null, subunitName: cur.subunitName as string | null });
}

async function assertNumberFree(tx: Tx, def: DocDef, companyId: string, number: string, selfId?: string) {
  const h = docTables[def.key].header;
  const conds: SQL[] = [eq(h.companyId, companyId), eq(h.documentNumber, number), isNull(h.deletedAt)];
  if (selfId) conds.push(ne(h.id, selfId));
  const [dup] = await tx.select({ id: h.id }).from(h).where(and(...conds)).limit(1);
  if (dup) {
    throw conflict(`${def.label} number "${number}" is already used`, {
      hint: 'Type a different number, or leave it blank to take the next number automatically.',
      fields: { documentNumber: 'Already used' },
    });
  }
}

async function writeChildren(tx: Tx, def: DocDef, companyId: string, documentId: string, p: ReturnType<typeof parsePayload>) {
  const t = docTables[def.key];
  await tx.delete(t.lines).where(eq(t.lines.documentId, documentId));
  await tx.delete(t.terms).where(eq(t.terms.documentId, documentId));
  if (t.containers) await tx.delete(t.containers).where(eq(t.containers.documentId, documentId));
  await tx.insert(t.lines).values(p.lines.map((l, i) => ({ ...l, companyId, documentId, position: i + 1, amount: lineAmount(l) })));
  if (p.terms.length) {
    await tx.insert(t.terms).values(p.terms.map((x, i) => ({ companyId, documentId, position: i + 1, tcTemplateId: x.tcTemplateId ?? null, content: x.content })));
  }
  if (t.containers && p.containers.length) {
    await tx.insert(t.containers).values(p.containers.map((c, i) => ({ ...c, companyId, documentId, position: i + 1 })));
  }
}

function checkContainers(p: ReturnType<typeof parsePayload>) {
  const seen = new Set<string>();
  for (const c of p.containers) {
    const n = String(c.containerNumber);
    if (seen.has(n)) throw badRequest(`Container ${n} is listed twice`, 'Remove the duplicate row from the container list.');
    seen.add(n);
    if (cmp(c.grossWeightKg as string, c.netWeightKg as string) < 0) {
      throw badRequest(`Container ${n}: gross weight is less than net weight`, 'Gross weight includes the bags, so it must be at least the net weight.');
    }
  }
}

async function prepare(tx: Tx, def: DocDef, body: unknown, selfId?: string) {
  const p = parsePayload(def, body);
  await checkRefs(tx, def.header, [p.header], '');
  await checkRefs(tx, def.lines, p.lines, 'Line: ');
  for (const l of p.lines) {
    if (!isPositive(l.quantityMt as string)) throw badRequest('Every line needs a net weight above zero', { fields: { quantityMt: 'Must be above 0' } });
  }
  checkContainers(p);
  // A commercial invoice generated against a production order belongs to that order's PI.
  if (def.key === 'commercialInvoices' && isUuid(p.header.productionOrderId) && !p.header.proformaInvoiceId) {
    const po = docTables.productionOrders.header;
    const [o] = await tx.select({ pi: po.proformaInvoiceId }).from(po).where(eq(po.id, p.header.productionOrderId));
    p.header.proformaInvoiceId = o?.pi ?? null;
  }
  for (const f of def.header.filter((x) => x.type === 'doc' && x.name !== def.parent?.field)) {
    const id = p.header[f.name];
    if (!isUuid(id)) continue;
    const h = docTables[f.ref as DocKey].header;
    const [hit] = await tx.select({ id: h.id }).from(h).where(and(eq(h.id, id), isNull(h.deletedAt)));
    if (!hit) throw badRequest(`${f.label}: not found`, { hint: 'Pick it again from the list.', fields: { [f.name]: 'Not found' } });
  }
  const totals = computeTotals(def, p.header, p.lines);
  await checkParentBalance(tx, def, p.header, totals.totalQuantityMt, selfId);
  const words = await currencyWords(tx, p.header.currencyId, documentValue(def, totals));
  return { p, totals, words };
}

// ------------------------------------------------------------------ CRUD
export async function createDocument(tx: Tx, ctx: RequestContext, key: string, body: unknown) {
  const { def, t } = resolveDoc(key);
  allow(ctx, def, 'create');
  const companyId = requireCompany(ctx);
  const { p, totals, words } = await prepare(tx, def, body);
  const typed = (p.header.documentNumber as string | null)?.trim();
  if (typed) await assertNumberFree(tx, def, companyId, typed);
  const documentNumber = typed || (await allocateNumber(tx, ctx, def.numbering, p.header.documentDate as string));
  const [row] = (await tx
    .insert(t.header)
    .values({ ...p.header, ...totals, documentNumber, amountInWords: words, companyId, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning()) as Row[];
  await writeChildren(tx, def, companyId, row.id as string, p);
  await audit(tx, ctx, { entity: def.key, recordId: row.id as string, action: 'create', after: row, meta: { lines: p.lines.length } });
  return getDocument(tx, ctx, key, row.id as string, 'create');
}

export async function updateDocument(tx: Tx, ctx: RequestContext, key: string, id: string, body: unknown) {
  const { def, t } = resolveDoc(key);
  allow(ctx, def, 'edit');
  const companyId = requireCompany(ctx);
  const before = await loadHeader(tx, def, id, true);
  const version = (body as Row | null)?.version;
  if (typeof version !== 'number') throw badRequest('The record version is missing', 'Reload the page and make your change again.');
  if (version !== before.version) throw conflict(`This ${def.label.toLowerCase()} was changed by another user while you were editing`);
  const { p, totals, words } = await prepare(tx, def, body, id);
  const typed = (p.header.documentNumber as string | null)?.trim() || (before.documentNumber as string);
  if (typed !== before.documentNumber) await assertNumberFree(tx, def, companyId, typed, id);
  await checkChildrenFit(tx, def, id, totals.totalQuantityMt, p.header.status);
  const [row] = (await tx
    .update(t.header)
    .set({ ...p.header, ...totals, documentNumber: typed, amountInWords: words, version: sql`${t.header.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
    .where(and(eq(t.header.id, id), eq(t.header.version, version)))
    .returning()) as Row[];
  if (!row) throw conflict(`This ${def.label.toLowerCase()} was changed by another user while you were editing`);
  await writeChildren(tx, def, companyId, id, p);
  await audit(tx, ctx, { entity: def.key, recordId: id, action: 'update', before, after: row, meta: { lines: p.lines.length } });
  return getDocument(tx, ctx, key, id, 'edit');
}

export async function deleteDocument(tx: Tx, ctx: RequestContext, key: string, id: string, reason: string) {
  const { def, t } = resolveDoc(key);
  allow(ctx, def, 'delete');
  if (!reason?.trim()) {
    throw badRequest('A reason is required to delete', { hint: 'Type why this document is being deleted; it is kept in the audit log.', fields: { reason: 'Required' } });
  }
  const before = await loadHeader(tx, def, id, true);
  for (const child of childDocs(def.key)) {
    const h = docTables[child.key].header;
    const kids = await tx
      .select({ n: h.documentNumber })
      .from(h)
      .where(and(eq(h[child.parent!.field], id), isNull(h.deletedAt)))
      .limit(5);
    if (kids.length) {
      throw badRequest(`${before.documentNumber} has ${child.plural.toLowerCase()}: ${kids.map((k) => k.n).join(', ')}`, {
        hint: `Delete those ${child.plural.toLowerCase()} first, or set this ${def.label.toLowerCase()}'s status to Cancelled instead of deleting it.`,
      });
    }
  }
  await tx.update(t.header).set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason.trim() }).where(eq(t.header.id, id));
  await audit(tx, ctx, { entity: def.key, recordId: id, action: 'delete', meta: { reason: reason.trim(), documentNumber: before.documentNumber } });
  return { ok: true };
}

async function loadHeader(tx: Tx, def: DocDef, id: string, lock = false): Promise<Row> {
  if (!isUuid(id)) throw notFound();
  const h = docTables[def.key].header;
  const q = tx.select().from(h).where(and(eq(h.id, id), isNull(h.deletedAt)));
  const [row] = (await (lock ? q.for('update') : q)) as Row[];
  if (!row) throw notFound(`${def.label} not found`, `It may have been deleted. Open ${def.plural} from the menu.`);
  return row;
}

async function loadChildren(tx: Tx, def: DocDef, id: string) {
  const t = docTables[def.key];
  const lines = (await tx.select().from(t.lines).where(eq(t.lines.documentId, id)).orderBy(asc(t.lines.position))) as Row[];
  const terms = (await tx.select().from(t.terms).where(eq(t.terms.documentId, id)).orderBy(asc(t.terms.position))) as Row[];
  const containers = t.containers ? ((await tx.select().from(t.containers).where(eq(t.containers.documentId, id)).orderBy(asc(t.containers.position))) as Row[]) : [];
  await refLabels(tx, def.lines, lines);
  return { lines, terms, containers };
}

/** Header + lines + terms (+ containers), with labels, linked child documents and the remaining balance. */
export async function getDocument(tx: Tx, ctx: RequestContext, key: string, id: string, action: Action = 'view') {
  const { def } = resolveDoc(key);
  allow(ctx, def, action);
  const header = await loadHeader(tx, def, id);
  await refLabels(tx, def.header, [header]);
  const children = [];
  for (const child of childDocs(def.key)) {
    const h = docTables[child.key].header;
    const rows = await tx
      .select({ id: h.id, documentNumber: h.documentNumber, documentDate: h.documentDate, status: h.status, totalQuantityMt: h.totalQuantityMt })
      .from(h)
      .where(and(eq(h[child.parent!.field], id), isNull(h.deletedAt)))
      .orderBy(asc(h.documentDate), asc(h.documentNumber));
    const used = await allocatedQty(tx, child, id);
    children.push({ doc: child.key, rows, usedMt: used, remainingMt: sub(header.totalQuantityMt as string, used, 3) });
  }
  return { ...header, ...(await loadChildren(tx, def, id)), children };
}

// ------------------------------------------------------------------ list, lookup, export
export interface DocListQuery {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  /** Only documents generated against this parent id. */
  parent?: string;
}

export async function listDocuments(tx: Tx, ctx: RequestContext, key: string, q: DocListQuery, action: Action = 'view') {
  const { def, t } = resolveDoc(key);
  allow(ctx, def, action);
  const h = t.header;
  const conds: SQL[] = [isNull(h.deletedAt)];
  if (q.status && def.statuses.includes(q.status)) conds.push(eq(h.status, q.status));
  if (q.parent && def.parent && isUuid(q.parent)) conds.push(eq(h[def.parent.field], q.parent));
  const term = q.search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
    const cust = masterTables.customers;
    const cols = def.header.filter((f) => f.search).map((f) => ilike(h[f.name], like));
    cols.push(inArray(h.buyerId, tx.select({ id: cust.id }).from(cust).where(ilike(cust.name, like))));
    conds.push(or(...cols)!);
  }
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 500);
  const page = Math.max(Number(q.page) || 1, 1);
  const where = and(...conds);
  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(h).where(where);
  const rows = (await tx
    .select()
    .from(h)
    .where(where)
    .orderBy(desc(h.documentDate), desc(h.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)) as Row[];
  await refLabels(tx, def.header, rows);
  // remaining balance for documents that feed another (PI → orders, order → invoices)
  for (const child of childDocs(def.key)) {
    const ch = docTables[child.key].header;
    const ids = rows.map((r) => r.id as string);
    if (!ids.length) break;
    const used = await tx
      .select({ parent: ch[child.parent!.field], q: sql<string>`sum(${ch.totalQuantityMt})::text` })
      .from(ch)
      .where(and(inArray(ch[child.parent!.field], ids), isNull(ch.deletedAt), ne(ch.status, CANCELLED)))
      .groupBy(ch[child.parent!.field]);
    const map = new Map(used.map((u) => [u.parent as string, round(u.q, 3)]));
    for (const r of rows) {
      const u = map.get(r.id as string) ?? '0.000';
      r._usedMt = u;
      r._remainingMt = sub(r.totalQuantityMt as string, u, 3);
    }
  }
  return { rows, total, page, pageSize };
}

/** Compact list for "generated against" pickers: open documents with quantity left. */
export async function lookupDocuments(tx: Tx, ctx: RequestContext, key: string, q: { q?: string; ids?: string }) {
  const { def, t } = resolveDoc(key);
  requireCompany(ctx);
  // Who may see these numbers: viewers of this document, or anyone creating/editing a document generated against it.
  const pickers = childDocs(def.key).flatMap((c) => [[c.module, 'create'], [c.module, 'edit']] as [string, Action][]);
  if (!can(ctx, def.module, 'view') && !pickers.some(([m, a]) => can(ctx, m, a))) requirePerm(ctx, def.module, 'view');
  const h = t.header;
  const conds: SQL[] = [isNull(h.deletedAt)];
  const ids = q.ids?.split(',').filter(isUuid);
  if (ids?.length) conds.push(inArray(h.id, ids));
  else conds.push(ne(h.status, CANCELLED));
  const term = q.q?.trim();
  if (term) conds.push(ilike(h.documentNumber, `%${term.replace(/[%_\\]/g, '\\$&')}%`));
  const rows = (await tx
    .select({ id: h.id, label: h.documentNumber, documentDate: h.documentDate, buyerId: h.buyerId, totalQuantityMt: h.totalQuantityMt })
    .from(h)
    .where(and(...conds))
    .orderBy(desc(h.documentDate))
    .limit(30)) as Row[];
  await refLabels(tx, [def.header.find((f) => f.name === 'buyerId')!], rows);
  return rows.map((r) => ({ id: r.id, label: r.label, sub: [r.documentDate, r.buyerIdLabel, `${round(r.totalQuantityMt as string, 3)} MT`].filter(Boolean).join(' · ') }));
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportDocuments(tx: Tx, ctx: RequestContext, key: string, q: DocListQuery) {
  const { def } = resolveDoc(key);
  const all: Row[] = [];
  for (let page = 1; ; page++) {
    const res = await listDocuments(tx, ctx, key, { ...q, page, pageSize: 500 }, 'export');
    all.push(...res.rows);
    if (all.length >= res.total || !res.rows.length) break;
  }
  const fields = def.header.filter((f) => f.type !== 'file' && f.type !== 'textarea' && f.type !== 'boolean');
  const header = [...fields.map((f) => f.label), ...def.totals.map((x) => x.label)];
  const out = [header.map(csvCell).join(',')];
  for (const r of all) {
    const cells = [...fields.map((f) => (f.type === 'ref' || f.type === 'doc' ? r[`${f.name}Label`] : r[f.name])), ...def.totals.map((x) => r[x.name])];
    out.push(cells.map(csvCell).join(','));
  }
  await audit(tx, ctx, { entity: def.key, action: 'export', meta: { rows: all.length } });
  return { filename: `${def.key}-${businessDate()}.csv`, body: `﻿${out.join('\r\n')}` };
}

// ------------------------------------------------------------------ drafts
/** Values for a new document: defaults, the company profile, default T&C — or copied from a parent. */
export async function draftDocument(tx: Tx, ctx: RequestContext, key: string, from?: string) {
  const { def } = resolveDoc(key);
  allow(ctx, def, 'create');
  const companyId = requireCompany(ctx);
  const header: Row = { documentNumber: null, documentDate: businessDate(), status: def.defaultStatus };
  for (const f of def.header) if (f.default !== undefined && header[f.name] === undefined) header[f.name] = f.default;

  const co = masterTables.companies;
  const [company] = (await tx.select().from(co).where(eq(co.id, companyId))) as Row[];
  if (def.header.some((f) => f.name === 'originCountryId')) header.originCountryId = company?.countryId ?? null;
  if (def.header.some((f) => f.name === 'lutNumber')) header.lutNumber = company?.lutNo ?? null;
  if (def.header.some((f) => f.name === 'bankAccountId')) {
    const b = masterTables.bankAccounts;
    const [bank] = await tx
      .select({ id: b.id })
      .from(b)
      .where(and(eq(b.companyId, companyId), isNull(b.deletedAt), eq(b.isActive, true)))
      .orderBy(desc(b.isDefault), asc(b.label))
      .limit(1);
    header.bankAccountId = bank?.id ?? null;
  }

  let lines: Row[] = [];
  if (from && def.parent) {
    const pdef = resolveDoc(def.parent.doc).def;
    const parent = await loadHeader(tx, pdef, from);
    if (parent.status === CANCELLED) throw badRequest(`${pdef.label} ${parent.documentNumber} is cancelled`, 'Pick an active one.');
    for (const name of inheritedFields(def)) header[name] = parent[name] ?? header[name] ?? null;
    header[def.parent.field] = parent.id;
    if (def.key === 'commercialInvoices') header.proformaInvoiceId = parent.proformaInvoiceId ?? null;
    const used = await allocatedByLine(tx, def, from);
    const { lines: plines } = await loadChildren(tx, pdef, from);
    const names = new Set(def.lines.map((f) => f.name));
    for (const pl of plines) {
      const remaining = sub(pl.quantityMt as string, used.get(pl.id as string) ?? '0', 3);
      if (!isPositive(remaining)) continue;
      const line: Row = { sourceLineId: pl.id };
      for (const f of def.lines) if (names.has(f.name) && pl[f.name] !== undefined) line[f.name] = pl[f.name];
      for (const f of def.lines) if (line[f.name] === undefined && f.default !== undefined) line[f.name] = f.default;
      if (cmp(remaining, pl.quantityMt as string) !== 0) {
        // part balance: scale bags and gross weight to the remaining net weight
        const share = (x: unknown, scale: number) =>
          x === null || x === undefined || !isPositive(String(x)) ? x : round(divideExact(mul(String(x), remaining, 9), pl.quantityMt as string), scale);
        line.noOfBags = Number(share(pl.noOfBags, 0) ?? 0);
        line.grossWtMt = share(pl.grossWtMt, 3) ?? null;
      }
      line.quantityMt = remaining;
      lines.push(line);
    }
    await refLabels(tx, def.lines, lines);
    if (!lines.length) {
      throw badRequest(`Nothing is left to generate against ${parent.documentNumber}`, {
        hint: `All ${round(parent.totalQuantityMt as string, 3)} MT is already on other ${def.plural.toLowerCase()}. Open the existing ones, or increase the ${pdef.label.toLowerCase()} first.`,
      });
    }
  }

  // default terms for this document type, one row per line of each default template
  const tc = masterTables.tcTemplates;
  const templates = await tx
    .select({ id: tc.id, body: tc.body })
    .from(tc)
    .where(and(eq(tc.docType, def.tcDocType), eq(tc.isDefault, true), eq(tc.isActive, true), isNull(tc.deletedAt)))
    .orderBy(asc(tc.name));
  const terms = templates.flatMap((tpl) => splitTerms(tpl.body as string).map((content) => ({ tcTemplateId: tpl.id, content })));
  await refLabels(tx, def.header, [header]);
  lines = lines.map((l) => ({ ...l, amount: lineAmount(l) }));
  return { ...header, lines, terms, containers: [] };
}

/** a ÷ b at 12 decimals (b > 0), for proportional splits. */
function divideExact(a: string, b: string): string {
  const [ai, af = ''] = round(a, 12).split('.');
  const [bi, bf = ''] = round(b, 12).split('.');
  const x = BigInt(`${ai}${af}`);
  const y = BigInt(`${bi}${bf}`);
  const q = (x * 10n ** 12n * 2n + y) / (y * 2n);
  const s = q.toString().padStart(13, '0');
  return `${s.slice(0, -12)}.${s.slice(-12)}`;
}

/** Template bodies hold one term per line; numbering like "1." or "a)" is stripped (the PDF numbers them). */
export const splitTerms = (body: string) =>
  body
    .split(/\r?\n/)
    .map((x) => x.replace(/^\s*(\d+|[a-z])[.)]\s+/i, '').trim())
    .filter(Boolean);

// ------------------------------------------------------------------ reports
export async function proformaFieldUsage(tx: Tx, ctx: RequestContext, field: string) {
  const { def, t } = resolveDoc('proformaInvoices');
  allow(ctx, def, 'view');
  const f = PI_REPORT_FIELDS.find((x) => x.name === field);
  if (!f) {
    throw badRequest(`"${field}" cannot be reported on`, `Choose one of: ${PI_REPORT_FIELDS.map((x) => x.label).join(', ')}.`);
  }
  const h = t.header;
  const col = h[f.name];
  const rows = await tx
    .select({
      value: sql<string | null>`${col}::text`,
      count: sql<number>`count(*)::int`,
      quantityMt: sql<string>`coalesce(sum(${h.totalQuantityMt}), 0)::text`,
      total: sql<string>`coalesce(sum(${h.grandTotal}), 0)::text`,
    })
    .from(h)
    .where(and(isNull(h.deletedAt), ne(h.status, CANCELLED)))
    .groupBy(col)
    .orderBy(sql`count(*) desc`);
  const fdef = def.header.find((x) => x.name === f.name)!;
  const decorated = rows.map((r) => ({ ...r, [f.name]: r.value })) as Row[];
  await refLabels(tx, [fdef], decorated);
  return {
    field: f.name,
    label: f.label,
    note: 'Totals add amounts in different currencies only when the grouping is by currency; compare quantities otherwise.',
    rows: decorated.map((r) => ({
      value: r.value === null ? '(blank)' : ((r[`${f.name}Label`] as string) ?? (r.value as string)),
      count: r.count,
      quantityMt: round(r.quantityMt as string, 3),
      total: round(r.total as string, 2),
    })),
  };
}

export async function proformaTermsUsage(tx: Tx, ctx: RequestContext) {
  const { def, t } = resolveDoc('proformaInvoices');
  allow(ctx, def, 'view');
  return tx
    .select({ content: t.terms.content, count: sql<number>`count(distinct ${t.terms.documentId})::int` })
    .from(t.terms)
    .innerJoin(t.header, eq(t.terms.documentId, t.header.id))
    .where(and(isNull(t.header.deletedAt), ne(t.header.status, CANCELLED)))
    .groupBy(t.terms.content)
    .orderBy(sql`2 desc`, asc(t.terms.content));
}

export const DOC_KEYS = DOC_LIST.map((d) => d.key);
