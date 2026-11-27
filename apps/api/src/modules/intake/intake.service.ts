/**
 * Document inbox: upload → read (text / offline OCR) → recognise → extract → match → review → confirm.
 * Reading runs in the background, one document at a time; a person always confirms before anything
 * reaches orders or lots. Confirming teaches the layout templates (corrections are remembered).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BUYER_PO,
  classify,
  extract,
  innerPacks,
  intakeKind,
  layoutFingerprint,
  learnTemplate,
  matchSupplier,
  PURCHASE_CATEGORY_KEYS,
  packKg,
  type Extracted,
  type ExtractedLine,
  type LayoutTemplate,
} from '@rmm/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { audit } from '../../core/audit.js';
import { inCompanyTx, type RequestContext } from '../../core/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import { db, type Tx } from '../../db/client.js';
import { companies, docTables, extractionTemplates, files, inboxItems, masterTables, shipmentDocuments, shipments, vendorPos } from '../../db/schema/index.js';
import { createDocument, draftDocument } from '../documents/documents.service.js';
import { createPurchaseInvoice, createPurchaseOrder } from '../purchases/purchases.service.js';
import { detectKind, readDocument, type FileKind } from './read.js';

type Item = typeof inboxItems.$inferSelect;
type Row = Record<string, unknown>;

export const MAX_INTAKE_BYTES = Math.max(1, Number(process.env.INTAKE_MAX_MB ?? 40) || 40) * 1024 * 1024;

// ------------------------------------------------------------------ upload

export interface StoredItem {
  id: string;
  fileName: string;
  duplicateOf: string | null;
}

/** Save one file into the inbox (or point at the same file already there). */
export async function storeUpload(
  companyId: string,
  userId: string | null,
  buf: Buffer,
  name: string,
  sourcePath: string | null = null,
  /** The order / lot folder the file was uploaded into (it stays there whatever the text says). */
  into: { orderId?: string | null; shipmentId?: string | null } = {},
): Promise<StoredItem> {
  const kind = detectKind(buf, name);
  if (!kind) {
    throw badRequest(`"${name}" is not a document the inbox can read`, 'Upload a PDF, a photo or scan (JPG, PNG, TIFF), Excel (.xlsx / .xls), Word (.docx / .doc) or a text file.');
  }
  if (buf.length > MAX_INTAKE_BYTES) throw badRequest(`"${name}" is larger than ${MAX_INTAKE_BYTES / 1024 / 1024} MB`, 'Split or compress the scan and upload it again.');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const stored = await inCompanyTx(companyId, async (tx): Promise<StoredItem> => {
    const [dupe] = await tx.select({ id: inboxItems.id, orderId: inboxItems.orderId, status: inboxItems.status }).from(inboxItems).where(and(eq(inboxItems.sha256, sha256), isNull(inboxItems.deletedAt))).limit(1);
    if (dupe) {
      // the same file, not yet filed anywhere: put it in the folder it was just uploaded into
      if (into.orderId && !dupe.orderId && dupe.status !== 'CONFIRMED') await tx.update(inboxItems).set({ orderId: into.orderId, shipmentId: into.shipmentId ?? null, updatedAt: new Date() }).where(eq(inboxItems.id, dupe.id));
      return { id: dupe.id, fileName: name, duplicateOf: dupe.id };
    }
    const fileId = randomUUID();
    const ext = (path.extname(name).replace(/[^a-z0-9.]/gi, '').toLowerCase() || '.bin').slice(0, 6);
    const rel = path.join(new Date().toISOString().slice(0, 7), `${fileId}${ext}`);
    const abs = path.join(config.storageDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf, { mode: 0o640 });
    await tx.insert(files).values({ id: fileId, companyId, originalName: name.slice(0, 200), mimeType: kind.mime, sizeBytes: buf.length, sha256, storagePath: rel, createdBy: userId });
    const [item] = await tx
      .insert(inboxItems)
      .values({ companyId, fileId, fileName: name.slice(0, 250), fileKind: kind.kind, sha256, sourcePath, status: 'QUEUED', orderId: into.orderId ?? null, shipmentId: into.shipmentId ?? null, createdBy: userId, updatedBy: userId })
      .returning({ id: inboxItems.id });
    await audit(tx, { userId, companyId, ip: null }, { entity: 'inbox', recordId: item.id, action: 'upload', meta: { name, kind: kind.kind, size: buf.length, sourcePath } });
    return { id: item.id, fileName: name, duplicateOf: null };
  });
  // only after the row is committed, or the reader would not find it yet
  if (!stored.duplicateOf) enqueue(companyId, stored.id);
  return stored;
}

// ------------------------------------------------------------------ background reader

const pending: { companyId: string; id: string }[] = [];
let running = false;
let onIdle: (() => void)[] = [];

export function enqueue(companyId: string, id: string) {
  pending.push({ companyId, id });
  void drain();
}

/** Resolves when every queued document has been read (used by the bulk import and tests). */
export function whenIdle(): Promise<void> {
  if (!running && !pending.length) return Promise.resolve();
  return new Promise((r) => onIdle.push(r));
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const next = pending.shift()!;
      await processItem(next.companyId, next.id).catch(() => undefined);
    }
  } finally {
    running = false;
    const waiting = onIdle;
    onIdle = [];
    waiting.forEach((r) => r());
  }
}

/** After a restart, pick up documents that were waiting or half read. */
export async function resumeQueued() {
  const cos = await db().select({ id: companies.id }).from(companies);
  for (const c of cos) {
    const rows = await inCompanyTx(c.id, (tx) =>
      tx.select({ id: inboxItems.id }).from(inboxItems).where(and(inArray(inboxItems.status, ['QUEUED', 'READING']), isNull(inboxItems.deletedAt))).orderBy(asc(inboxItems.createdAt)),
    );
    for (const r of rows) enqueue(c.id, r.id);
  }
}

async function templatesFor(tx: Tx, fingerprint: string): Promise<LayoutTemplate[]> {
  const rows = await tx.select().from(extractionTemplates).where(eq(extractionTemplates.fingerprint, fingerprint));
  // stored as "same-line|token": where the value is, and how far it runs
  return rows.map((r) => { const [position, shape] = r.position.split('|'); return { field: r.field, anchor: r.anchor, position: position as LayoutTemplate['position'], shape: (shape as LayoutTemplate['shape']) ?? undefined }; });
}

export async function processItem(companyId: string, id: string, forceKind?: string) {
  const item = await inCompanyTx(companyId, async (tx) => {
    const [row] = await tx.select().from(inboxItems).where(eq(inboxItems.id, id));
    if (!row || row.deletedAt || row.status === 'CONFIRMED') return null;
    await tx.update(inboxItems).set({ status: 'READING', error: null, updatedAt: new Date() }).where(eq(inboxItems.id, id));
    const [f] = await tx.select().from(files).where(eq(files.id, row.fileId));
    return { row, file: f };
  });
  if (!item?.file) return;
  const t0 = Date.now();
  try {
    const buf = await readFile(path.join(config.storageDir, item.file.storagePath));
    const read = item.row.text && forceKind ? { text: item.row.text, pages: item.row.pages ?? 1, method: item.row.readMethod as 'text', ocrConfidence: item.row.ocrConfidence } : await readDocument(buf, item.row.fileKind as FileKind, item.file.mimeType);
    const c = forceKind ? { kind: forceKind, confidence: 1 } : classify(read.text, item.row.fileName);
    const fingerprint = layoutFingerprint(read.text, c.kind);
    await inCompanyTx(companyId, async (tx) => {
      const x = extract(read.text, c.kind, await templatesFor(tx, fingerprint));
      const m = await matchRefs(tx, x.refs, x.fields);
      await tx
        .update(inboxItems)
        .set({
          status: read.text.trim() ? 'TO_REVIEW' : 'FAILED',
          error: read.text.trim() ? null : 'No text could be read from this file (blank page or unreadable scan).',
          kind: c.kind,
          kindConfidence: String(c.confidence),
          readMethod: read.method,
          ocrConfidence: read.ocrConfidence,
          pages: read.pages,
          text: read.text.slice(0, 400_000),
          fingerprint,
          fields: x.fields,
          lines: x.lines,
          refs: x.refs,
          // an order / lot chosen at upload (or earlier) is kept; the numbers in the text fill what is missing
          orderId: item.row.orderId ?? m.orderId,
          shipmentId: item.row.shipmentId ?? (!item.row.orderId || item.row.orderId === m.orderId ? m.shipmentId : null),
          readMs: Date.now() - t0,
          updatedAt: new Date(),
        })
        .where(eq(inboxItems.id, id));
    });
  } catch (e) {
    await inCompanyTx(companyId, (tx) =>
      tx
        .update(inboxItems)
        .set({ status: 'FAILED', error: `Could not read the file: ${(e as Error).message}`.slice(0, 500), readMs: Date.now() - t0, updatedAt: new Date() })
        .where(eq(inboxItems.id, id)),
    );
  }
}

// ------------------------------------------------------------------ matching

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
/** Is this number written in the text, whole (…/001 is not found inside …/0012)? Short numbers are ignored. */
function mentions(text: string, number: string) {
  const n = norm(number);
  const t = text.toUpperCase();
  if (n.length < 6) return false;
  for (let at = t.indexOf(n); at >= 0; at = t.indexOf(n, at + 1)) {
    if (!/[A-Z0-9]/.test(t.charAt(at - 1)) && !/[A-Z0-9]/.test(t.charAt(at + n.length))) return true;
  }
  return false;
}

/** Find the order and lot a document belongs to from the numbers in it. */
export async function matchRefs(tx: Tx, refs: Record<string, string[]>, fields: Record<string, Extracted>) {
  const pi = docTables.proformaInvoices.header;
  const ci = docTables.commercialInvoices.header;
  const invoices = [...new Set([...(refs.invoiceNumbers ?? []), fields.invoiceNumber?.value].filter(Boolean).map((x) => norm(x!)))];
  const bls = [...new Set([...(refs.blNumbers ?? []), fields.blNumber?.value, fields.bookingNo?.value].filter(Boolean).map((x) => norm(x!)))];
  const pos = [...new Set([...(refs.poNumbers ?? []), fields.buyerPoRef?.value].filter(Boolean).map((x) => norm(x!)))];
  const lcs = [...new Set([...(refs.lcNumbers ?? []), fields.lcNumber?.value].filter(Boolean).map((x) => norm(x!)))];
  let shipmentId: string | null = null;
  let orderId: string | null = null;
  if (invoices.length || bls.length) {
    const conds = [];
    if (invoices.length) conds.push(inArray(sql`upper(replace(${shipments.invoiceNumber}, ' ', ''))`, invoices));
    if (bls.length) conds.push(inArray(sql`upper(replace(${shipments.blNumber}, ' ', ''))`, bls), inArray(sql`upper(replace(${shipments.bookingNo}, ' ', ''))`, bls));
    const [s] = await tx.select({ id: shipments.id, pi: shipments.proformaInvoiceId }).from(shipments).where(and(isNull(shipments.deletedAt), or(...conds))).limit(1);
    if (s) {
      shipmentId = s.id;
      orderId = s.pi;
    }
    if (!shipmentId && invoices.length) {
      const [s2] = (await tx
        .select({ id: shipments.id, pi: shipments.proformaInvoiceId })
        .from(shipments)
        .innerJoin(ci, eq(ci.id, shipments.commercialInvoiceId))
        .where(and(isNull(shipments.deletedAt), inArray(sql`upper(replace(${ci.documentNumber}, ' ', ''))`, invoices)))
        .limit(1)) as { id: string; pi: string }[];
      if (s2) {
        shipmentId = s2.id;
        orderId = s2.pi;
      }
    }
  }
  if (!orderId && (pos.length || lcs.length)) {
    const conds = [];
    if (pos.length) conds.push(inArray(sql`upper(replace(${pi.buyerPoRef}, ' ', ''))`, pos));
    if (lcs.length) conds.push(inArray(sql`upper(replace(${pi.lcNumber}, ' ', ''))`, lcs));
    const [o] = (await tx.select({ id: pi.id }).from(pi).where(and(isNull(pi.deletedAt), or(...conds))).orderBy(desc(pi.documentDate)).limit(1)) as { id: string }[];
    if (o) orderId = o.id;
  }
  const poNo = fields.vendorPoNo?.value;
  if (!orderId && poNo) {
    const [v] = await tx.select({ orderId: vendorPos.proformaInvoiceId }).from(vendorPos).where(and(sql`upper(replace(${vendorPos.number}, ' ', '')) = ${norm(poNo)}`, isNull(vendorPos.deletedAt))).limit(1);
    if (v?.orderId) orderId = v.orderId;
  }
  return { orderId, shipmentId };
}

// ------------------------------------------------------------------ suggestions for the review screen

async function findByName(tx: Tx, key: string, name: string | null | undefined, extra?: ReturnType<typeof eq>) {
  if (!name?.trim()) return null;
  const t = masterTables[key];
  const words = name
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  if (!words.length) return null;
  const conds = [isNull(t.deletedAt), ...words.map((w) => ilike(t.name, `%${w}%`))];
  if (extra) conds.push(extra);
  const [row] = (await tx.select({ id: t.id, label: t.name }).from(t).where(and(...conds)).limit(1)) as { id: string; label: string }[];
  return row ?? null;
}

/** Words of a company name that say nothing about who it is. */
const GENERIC_NAME = new Set(['foods', 'food', 'trading', 'traders', 'company', 'llc', 'ltd', 'limited', 'private', 'pvt', 'general', 'international', 'group', 'establishment', 'import', 'export', 'exports', 'imports', 'the', 'and', 'rice', 'agro', 'industries', 'enterprises', 'fze', 'fzco', 'w.l.l.', 'wll', 'co.', 'est']);

/**
 * A buyer PO often names the buyer only in its logo; the name still shows up in its terms ("… where
 * <Buyer> will apply a penalty"). Pick the customer whose distinctive name words are written on the
 * document (never our own company, which the PO names as the supplier).
 */
async function customerNamedIn(tx: Tx, item: Item) {
  const text = (item.text ?? '').toLowerCase();
  if (!text) return null;
  const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z.&'-]{2,}/g) ?? []).filter((w) => !GENERIC_NAME.has(w));
  const [own] = await tx.select({ name: companies.name, legal: companies.legalName }).from(companies).where(eq(companies.id, item.companyId));
  const ours = new Set(words(`${own?.name ?? ''} ${own?.legal ?? ''}`));
  const c = masterTables.customers;
  const all = (await tx.select({ id: c.id, label: c.name }).from(c).where(isNull(c.deletedAt))) as { id: string; label: string }[];
  let best: { id: string; label: string; hits: number } | null = null;
  for (const cu of all) {
    const ws = [...new Set(words(cu.label))].filter((w) => !ours.has(w));
    const hits = ws.filter((w) => new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(text)).length;
    if (hits && (!best || hits > best.hits)) best = { ...cu, hits };
  }
  return best ? { id: best.id, label: best.label } : null;
}

/** Best guesses for the master records an order needs (buyer, currency, ports, packing). */
export async function suggestFor(tx: Tx, item: Item) {
  const fields = item.fields ?? {};
  const cur = masterTables.currencies;
  const code = fields.currency?.value;
  const [currency] = code ? ((await tx.select({ id: cur.id, label: cur.code, rate: cur.exchangeRate }).from(cur).where(and(eq(cur.code, code), isNull(cur.deletedAt))).limit(1)) as { id: string; label: string; rate: string }[]) : [];
  const packing = masterTables.packingTypes;
  const packs = (await tx.select({ id: packing.id, label: packing.name, kg: packing.netWeightKg }).from(packing).where(isNull(packing.deletedAt))) as { id: string; label: string; kg: string }[];
  const lines = await Promise.all(
    (item.lines ?? []).map(async (l: ExtractedLine) => {
      const kg = l.packKg ?? packKg(l.description);
      // same bag weight and the same number of inner packs: never offer a plain 40 kg bag for "4 × 10 kg"
      const inner = innerPacks(l.packing ?? l.description);
      const pack = kg ? (packs.find((p) => Number(p.kg) === kg && innerPacks(p.label) === inner) ?? null) : null;
      return { port: await findByName(tx, 'ports', l.port), packing: pack ? { id: pack.id, label: pack.label } : null, product: await findByName(tx, 'products', l.description) };
    }),
  );
  return {
    buyer: (await findByName(tx, 'customers', fields.buyerName?.value)) ?? (await customerNamedIn(tx, item)),
    currency: currency ?? null,
    portOfLoading: await findByName(tx, 'ports', fields.portOfLoading?.value),
    portOfDischarge: await findByName(tx, 'ports', fields.portOfDischarge?.value),
    lines,
  };
}

/** For a supplier bill or our purchase order: which supplier and which purchase order it is. */
export async function suggestPurchase(tx: Tx, item: Item) {
  const fields = item.fields ?? {};
  const su = masterTables.suppliers;
  const all = (await tx.select({ id: su.id, name: su.name, gstin: su.gstin }).from(su).where(and(isNull(su.deletedAt), eq(su.isActive, true)))) as { id: string; name: string; gstin: string | null }[];
  const gstins = (item.text ?? '').toUpperCase();
  const written = fields.supplierName?.value ?? fields.vendorName?.value;
  // a GSTIN printed on the document identifies the supplier for certain; else the written name
  const found = all.find((s) => s.gstin && gstins.includes(s.gstin.toUpperCase())) ?? (written ? matchSupplier(written, all) : null);
  const poNo = fields.vendorPoNo?.value;
  const pos = await tx.select({ id: vendorPos.id, label: vendorPos.number, supplierId: vendorPos.supplierId }).from(vendorPos).where(isNull(vendorPos.deletedAt)).orderBy(desc(vendorPos.createdAt)).limit(2000);
  // the number read under a "PO no." label; else any of our own PO numbers printed anywhere on the bill
  const po = (poNo ? pos.find((p) => norm(p.label) === norm(poNo)) : undefined) ?? pos.find((p) => (!found || p.supplierId === found.id) && mentions(item.text ?? '', p.label));
  const supplier = found ?? (po ? (all.find((s) => s.id === po.supplierId) ?? null) : null);
  return { supplier: supplier ? { id: supplier.id, label: supplier.name } : null, vendorPo: po && (!supplier || po.supplierId === supplier.id) ? { id: po.id, label: po.label } : null };
}

// ------------------------------------------------------------------ confirm

export interface ConfirmBody {
  kind: string;
  fields: Record<string, string | null>;
  orderId?: string | null;
  shipmentId?: string | null;
  order?: Record<string, unknown> & { lines?: Record<string, unknown>[] };
  /** Buying side: which supplier, what for, against which purchase order. */
  purchase?: { supplierId?: string | null; category?: (typeof PURCHASE_CATEGORY_KEYS)[number]; vendorPoId?: string | null; description?: string | null };
}

const blank = (v: string | null | undefined) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const dateOrNull = (v: string | null | undefined) => (blank(v) && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);

async function markLotDoc(tx: Tx, ctx: RequestContext, item: Item, shipmentId: string, kind: string, refNo: string | null, docDate: string | null) {
  await tx
    .insert(shipmentDocuments)
    .values({ companyId: item.companyId, shipmentId, kind, status: 'RECEIVED', fileId: item.fileId, inboxItemId: item.id, refNo, docDate, updatedBy: ctx.userId })
    .onConflictDoUpdate({
      target: [shipmentDocuments.shipmentId, shipmentDocuments.kind],
      set: { status: 'RECEIVED', fileId: item.fileId, inboxItemId: item.id, refNo, docDate, updatedBy: ctx.userId, updatedAt: new Date() },
    });
}

async function loadLot(tx: Tx, id: string | null | undefined) {
  if (!id) throw badRequest('Choose the shipment lot this document belongs to', { fields: { shipmentId: 'Required' }, hint: 'Pick the order and lot on the right. Lots are created in Plan shipments.' });
  const [s] = (await tx.select().from(shipments).where(and(eq(shipments.id, id), isNull(shipments.deletedAt)))) as Row[];
  if (!s) throw notFound('Shipment lot not found', 'It may have been deleted. Pick another lot.');
  return s;
}

/** Apply a reviewed document to the ERP, remember the corrections, and file it. */
/** Every value the person typed or changed is remembered for this layout. Returns how many. */
async function learnCorrections(tx: Tx, ctx: RequestContext, item: Item, kindKey: string, v: Record<string, string | null>) {
  const fingerprint = kindKey === item.kind && item.fingerprint ? item.fingerprint : layoutFingerprint(item.text ?? '', kindKey);
  let learned = 0;
  for (const [field, value] of Object.entries(v)) {
    const val = blank(value);
    if (!val || field === 'isDraft') continue;
    const before = (item.fields ?? {})[field];
    if (before && before.value === val && kindKey === item.kind) continue;
    // dates are shown as yyyy-mm-dd; learn from how the document writes them is not possible, so skip
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) continue;
    const t = learnTemplate(item.text ?? '', field, val);
    if (!t) continue;
    await tx
      .insert(extractionTemplates)
      .values({ companyId: item.companyId, kind: kindKey, fingerprint, field, anchor: t.anchor, position: `${t.position}|${t.shape ?? 'phrase'}`, createdBy: ctx.userId })
      .onConflictDoUpdate({ target: [extractionTemplates.companyId, extractionTemplates.fingerprint, extractionTemplates.field], set: { anchor: t.anchor, position: `${t.position}|${t.shape ?? 'phrase'}`, uses: sql`${extractionTemplates.uses} + 1`, updatedAt: new Date() } });
    learned++;
  }
  return learned;
}

/** The values as checked by the person (kept with the words they were read from). */
function checkedFields(item: Item, v: Record<string, string | null>): Record<string, Extracted> {
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => blank(x))
      .map(([k, x]) => [k, { value: String(x), confidence: 1, evidence: (item.fields ?? {})[k]?.evidence ?? 'entered by user', source: (item.fields ?? {})[k]?.value === x ? ((item.fields ?? {})[k]?.source ?? 'user') : 'user' }]),
  );
}

/**
 * Keep what the person checked on the review screen before the full order form opens: corrections are
 * remembered for the layout, and the form starts from these values.
 */
export async function saveCheckedFields(tx: Tx, ctx: RequestContext, item: Item, kindKey: string, v: Record<string, string | null>) {
  const kind = intakeKind(kindKey);
  if (kind.action !== 'order') throw badRequest(`A ${kind.label.toLowerCase()} does not open the order form`);
  const learned = await learnCorrections(tx, ctx, item, kind.key, v);
  await tx
    .update(inboxItems)
    .set({ kind: kind.key, fields: { ...(item.fields ?? {}), ...checkedFields(item, v) }, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${inboxItems.version} + 1` })
    .where(eq(inboxItems.id, item.id));
  return { learned };
}

const toIncoterm = (v: string | null | undefined) => {
  const x = (v ?? '').toUpperCase().replace(/\s/g, '');
  return x === 'CIF' ? 'CIF' : x === 'CFR' || x === 'C&F' || x === 'CNF' ? 'CFR' : 'FOB';
};

/**
 * A new order (Orders / PIs) filled from a buyer PO or PI in the inbox: everything the order form would
 * start with (bank, origin, terms) plus what was read. Master records are picked where they match;
 * anything else is kept as text typed on this order only, so nothing read is lost.
 */
export async function orderDraft(tx: Tx, ctx: RequestContext, item: Item) {
  const kind = intakeKind(item.kind);
  if (kind.action !== 'order') throw badRequest(`This document was read as a ${kind.label.toLowerCase()}, not an order`, 'Choose "Buyer PO / contract" or "Proforma invoice" as the document type first.');
  const draft = (await draftDocument(tx, ctx, 'proformaInvoices')) as Row & { lines: Row[]; terms: Row[] };
  const f = Object.fromEntries(Object.entries(item.fields ?? {}).map(([k, x]) => [k, x.value])) as Record<string, string | undefined>;
  const s = await suggestFor(tx, item);
  const h: Row = { ...draft };
  const ref = (name: string, hit: { id: string; label: string } | null | undefined, text: string | null | undefined) => {
    if (hit) {
      h[name] = hit.id;
      h[`${name}Label`] = hit.label;
    } else if (blank(text)) h[`${name}Text`] = blank(text);
  };
  h.orderSource = kind.key === 'proforma' ? 'Our PI' : BUYER_PO;
  h.documentDate = dateOrNull(f.poDate) ?? h.documentDate;
  h.poDate = dateOrNull(f.poDate);
  h.buyerPoRef = blank(f.buyerPoRef) ?? (kind.key === 'proforma' ? blank(f.piNumber) : null);
  h.incoterm = toIncoterm(f.incoterm);
  h.paymentTerms = blank(f.paymentTerms);
  h.deliveryTimeline = dateOrNull(f.deliveryDate) ? `Shipment by ${f.deliveryDate}` : null;
  h.specCropYear = blank(f.cropYear);
  h.brand = blank(f.brand);
  h.lcNumber = blank(f.lcNumber);
  ref('buyerId', s.buyer, f.buyerName);
  ref('portOfLoadingId', s.portOfLoading, f.portOfLoading);
  ref('portOfDischargeId', s.portOfDischarge, f.portOfDischarge);
  if (s.currency) {
    h.currencyId = s.currency.id;
    h.currencyIdLabel = s.currency.label;
    h.exchangeRate = null; // the form fills today's live rate for this currency
  }
  const pt = await findByName(tx, 'paymentTerms', f.paymentTerms);
  if (pt) {
    h.paymentTermId = pt.id;
    h.paymentTermIdLabel = pt.label;
  }
  const groups = new Map<string, number>();
  h.lines = (item.lines ?? []).map((l: ExtractedLine, i: number) => {
    const sl = s.lines[i];
    const line: Row = { quantityMt: l.quantityMt, ratePerMt: l.rate, dispatchBy: l.dispatchBy ?? dateOrNull(f.deliveryDate), buyerItemCode: l.buyerItemCode, brand: blank(f.brand), noOfBags: l.bags ?? 0 };
    const set = (name: string, hit: { id: string; label: string } | null | undefined, text: string | null | undefined) => {
      if (hit) {
        line[name] = hit.id;
        line[`${name}Label`] = hit.label;
      } else if (blank(text)) line[`${name}Text`] = blank(text);
    };
    set('productId', sl?.product, l.description);
    set('packingTypeId', sl?.packing, l.packing ?? (l.packKg ? `${l.packKg} KG` : null));
    set('destinationPortId', sl?.port, l.port);
    // packings of the same product sit under one product card
    const key = (line.productId as string) ?? `line-${i}`;
    if (!groups.has(key)) groups.set(key, groups.size + 1);
    line.packGroup = groups.get(key);
    return line;
  });
  return { ...h, intake: { id: item.id, fileId: item.fileId, fileName: item.fileName, kind: kind.key } };
}

/** The order made in the full form from this document: file the document with it. */
export async function linkCreatedOrder(tx: Tx, ctx: RequestContext, item: Item, orderId: string) {
  const pi = docTables.proformaInvoices.header;
  const [o] = (await tx.select({ id: pi.id }).from(pi).where(and(eq(pi.id, orderId), isNull(pi.deletedAt)))) as Row[];
  if (!o) throw notFound('Order not found', 'Save the order first, then file the document with it.');
  const result = `order:${orderId}`;
  await tx
    .update(inboxItems)
    .set({ status: 'CONFIRMED', result, orderId, confirmedAt: new Date(), confirmedBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${inboxItems.version} + 1` })
    .where(eq(inboxItems.id, item.id));
  await audit(tx, ctx, { entity: 'inbox', recordId: item.id, action: 'confirm', meta: { kind: item.kind, result, via: 'order form' } });
  return { result };
}

export async function confirmItem(tx: Tx, ctx: RequestContext, item: Item, body: ConfirmBody) {
  const kind = intakeKind(body.kind);
  const v = body.fields ?? {};
  let result = 'filed';
  /** Order the document ends up under, when confirming works it out (from the purchase order). */
  let linkedOrder: string | null = null;
  switch (kind.action) {
    case 'order': {
      const o = body.order ?? {};
      const doc = await createDocument(tx, ctx, 'proformaInvoices', {
        documentDate: dateOrNull(v.poDate) ?? new Date().toISOString().slice(0, 10),
        status: 'CONFIRMED',
        orderSource: kind.key === 'proforma' ? 'Our PI' : BUYER_PO,
        documentNumber: kind.key === 'proforma' ? blank(v.piNumber) : null,
        buyerPoRef: blank(v.buyerPoRef),
        poDate: dateOrNull(v.poDate),
        paymentTerms: blank(v.paymentTerms),
        deliveryTimeline: dateOrNull(v.deliveryDate) ? `Shipment by ${v.deliveryDate}` : null,
        specCropYear: blank(v.cropYear),
        brand: blank(v.brand),
        incoterm: blank(v.incoterm)?.toUpperCase() === 'CIF' ? 'CIF' : blank(v.incoterm)?.toUpperCase() === 'CFR' ? 'CFR' : 'FOB',
        ...o,
        lines: (o.lines ?? []).map((l) => ({ ...l })),
        terms: [],
      });
      result = `order:${(doc as unknown as { id: string }).id}`;
      break;
    }
    case 'order-lc': {
      const pi = docTables.proformaInvoices.header;
      if (!body.orderId) throw badRequest('Choose the order this LC belongs to', { fields: { orderId: 'Required' } });
      const [before] = (await tx.select().from(pi).where(and(eq(pi.id, body.orderId), isNull(pi.deletedAt)))) as Row[];
      if (!before) throw notFound('Order not found');
      await tx
        .update(pi)
        .set({ lcNumber: blank(v.lcNumber) ?? before.lcNumber, lcDate: dateOrNull(v.lcDate) ?? before.lcDate, version: sql`${pi.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(pi.id, body.orderId));
      await audit(tx, ctx, { entity: 'proformaInvoices', recordId: body.orderId, action: 'update', meta: { from: 'inbox', lcNumber: v.lcNumber, inboxItem: item.id } });
      result = `order:${body.orderId}`;
      break;
    }
    case 'lot': {
      const s = await loadLot(tx, body.shipmentId);
      const set: Row = { updatedAt: new Date(), updatedBy: ctx.userId };
      if (kind.key === 'booking') Object.assign(set, { bookingNo: blank(v.bookingNo) ?? s.bookingNo, shippingLine: blank(v.shippingLine) ?? s.shippingLine, vessel: blank(v.vessel) ?? s.vessel, etd: dateOrNull(v.etd) ?? s.etd, eta: dateOrNull(v.eta) ?? s.eta });
      if (kind.key === 'bill_of_lading') {
        Object.assign(set, {
          blNumber: blank(v.blNumber) ?? s.blNumber,
          blDate: dateOrNull(v.blDate) ?? s.blDate,
          vessel: blank(v.vessel) ?? s.vessel,
          shippingLine: blank(v.shippingLine) ?? s.shippingLine,
          blStatus: blank(v.isDraft) && /^(y|yes|true|draft)$/i.test(String(v.isDraft)) ? 'DRAFT' : 'RECEIVED',
        });
      }
      if (kind.key === 'shipping_bill') Object.assign(set, { sbNumber: blank(v.sbNumber) ?? s.sbNumber, sbDate: dateOrNull(v.sbDate) ?? s.sbDate, leoDate: dateOrNull(v.leoDate) ?? s.leoDate });
      if (kind.key === 'export_invoice') Object.assign(set, { invoiceNumber: blank(v.invoiceNumber) ?? s.invoiceNumber, invoiceAmount: blank(v.amount) ?? s.invoiceAmount });
      await tx.update(shipments).set(set).where(eq(shipments.id, s.id as string));
      const ref = blank(v.blNumber) ?? blank(v.sbNumber) ?? blank(v.bookingNo) ?? blank(v.invoiceNumber);
      const date = dateOrNull(v.blDate) ?? dateOrNull(v.sbDate) ?? dateOrNull(v.invoiceDate) ?? dateOrNull(v.etd);
      await markLotDoc(tx, ctx, item, s.id as string, kind.key, ref, date);
      await audit(tx, ctx, { entity: 'shipments', recordId: s.id as string, action: 'update', meta: { from: 'inbox', document: kind.key, inboxItem: item.id, ...set, updatedAt: undefined } });
      result = `lot:${s.id as string}`;
      break;
    }
    case 'lot-doc': {
      const s = await loadLot(tx, body.shipmentId);
      await markLotDoc(tx, ctx, item, s.id as string, kind.key, blank(v.certificateNo) ?? blank(v.reportNo) ?? blank(v.invoiceNumber), dateOrNull(v.certificateDate) ?? dateOrNull(v.reportDate));
      result = `lot:${s.id as string}`;
      break;
    }
    case 'purchase': {
      const p = body.purchase ?? {};
      if (!p.supplierId) throw badRequest('Choose the supplier of this bill', { fields: { supplierId: 'Required' } });
      if (!dateOrNull(v.invoiceDate)) throw badRequest('Enter the invoice date', { fields: { invoiceDate: 'Required' } });
      const bill = await createPurchaseInvoice(tx, ctx, {
        invoiceNo: blank(v.invoiceNo) ?? '',
        invoiceDate: v.invoiceDate,
        supplierId: p.supplierId,
        category: p.category ?? 'PACKAGING',
        vendorPoId: p.vendorPoId ?? null,
        proformaInvoiceId: body.orderId ?? null,
        shipmentId: body.shipmentId ?? null,
        description: p.description ?? null,
        quantity: blank(v.quantity),
        taxableAmount: blank(v.taxableAmount),
        gstAmount: blank(v.gstAmount),
        totalAmount: blank(v.totalAmount) ?? '',
        fileId: item.fileId,
        inboxItemId: item.id,
      });
      linkedOrder = bill.proformaInvoiceId;
      result = `purchase-invoice:${bill.id}`;
      break;
    }
    case 'vendor-po': {
      const p = body.purchase ?? {};
      const number = blank(v.vendorPoNo);
      const [existing] = number ? await tx.select({ id: vendorPos.id, orderId: vendorPos.proformaInvoiceId }).from(vendorPos).where(and(sql`upper(replace(${vendorPos.number}, ' ', '')) = ${norm(number)}`, isNull(vendorPos.deletedAt))).limit(1) : [];
      if (existing) {
        // the same purchase order is already in the ERP: file the document with it
        linkedOrder = existing.orderId ?? body.orderId ?? null;
        result = `purchase-order:${existing.id}`;
        break;
      }
      if (!p.supplierId) throw badRequest('Choose the supplier of this purchase order', { fields: { supplierId: 'Required' } });
      const total = blank(v.totalAmount);
      const po = await createPurchaseOrder(tx, ctx, {
        number,
        poDate: dateOrNull(v.poDate) ?? new Date().toISOString().slice(0, 10),
        supplierId: p.supplierId,
        category: p.category ?? 'PACKAGING',
        proformaInvoiceId: body.orderId ?? null,
        status: 'SENT',
        notes: `From the uploaded document ${item.fileName}`,
        lines: [{ description: p.description || 'As per the attached purchase order', quantity: 1, unit: 'Lot', rate: total ?? '' }],
      });
      linkedOrder = po.proformaInvoiceId;
      result = `purchase-order:${po.id}`;
      break;
    }
    default:
      result = 'filed';
  }

  const learned = await learnCorrections(tx, ctx, item, kind.key, v);
  const confirmedFields = checkedFields(item, v);
  await tx
    .update(inboxItems)
    .set({ status: 'CONFIRMED', kind: kind.key, fields: confirmedFields, result, // a PO confirmed into a new order belongs to that order, whatever was suggested before
      orderId: result.startsWith('order:') ? result.slice(6) : (linkedOrder ?? body.orderId ?? item.orderId), shipmentId: body.shipmentId ?? item.shipmentId, confirmedAt: new Date(), confirmedBy: ctx.userId, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${inboxItems.version} + 1` })
    .where(eq(inboxItems.id, item.id));
  await audit(tx, ctx, { entity: 'inbox', recordId: item.id, action: 'confirm', meta: { kind: kind.key, result, learned } });
  return { result, learned };
}
