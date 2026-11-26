/**
 * Old folders → inbox, and a measured accuracy report — both run from the command line on the server,
 * against the LOCAL COPY of the share (the original share is never written to).
 *
 *   intake-import <folder> --company RMM [--limit 500] [--only pdf,xls]
 *   intake-accuracy <folder> [--limit 300] [--out report.csv]
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { classify, extract, INTAKE_KINDS } from '@rmm/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { companies, inboxItems } from '../../db/schema/index.js';
import { inCompanyTx } from '../../core/context.js';
import { detectKind, readDocument, stopOcr } from './read.js';
import { storeUpload, whenIdle } from './intake.service.js';

const SUPPORTED = /\.(pdf|jpe?g|png|tiff?|webp|xlsx|xls|docx|doc|txt)$/i;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && SUPPORTED.test(e.name) && !e.name.startsWith('~$')) yield p;
  }
}

function flag(args: string[], name: string): string | null {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

export async function bulkImport(args: string[]) {
  const folder = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
  const code = flag(args, 'company');
  if (!folder || !code) throw new Error('Usage: intake-import <folder> --company <CODE> [--limit N] [--only pdf,xls]');
  const limit = Number(flag(args, 'limit') ?? 0) || Infinity;
  const only = flag(args, 'only')?.split(',').map((x) => x.trim().toLowerCase());
  const [co] = await db().select({ id: companies.id }).from(companies).where(eq(companies.code, code.toUpperCase()));
  if (!co) throw new Error(`No company with code ${code}`);
  let added = 0;
  let dupes = 0;
  let skipped = 0;
  for await (const file of walk(folder)) {
    if (added + dupes >= limit) break;
    if (only && !only.includes(path.extname(file).slice(1).toLowerCase())) continue;
    const s = await stat(file);
    if (s.size > 40 * 1024 * 1024) {
      skipped++;
      continue;
    }
    try {
      const r = await storeUpload(co.id, null, await readFile(file), path.basename(file), path.relative(folder, file));
      if (r.duplicateOf) dupes++;
      else added++;
      if ((added + dupes) % 25 === 0) console.log(`  queued ${added} new, ${dupes} already in the inbox…`);
    } catch (e) {
      skipped++;
      console.log(`  skipped ${path.relative(folder, file)}: ${(e as Error).message}`);
    }
  }
  console.log(`queued ${added} new document(s), ${dupes} duplicate(s), ${skipped} skipped — reading them now (offline OCR may take a few seconds per scanned page)…`);
  await whenIdle();
  const rows = await inCompanyTx(co.id, (tx) => tx.select({ kind: inboxItems.kind, status: inboxItems.status }).from(inboxItems));
  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(`${r.kind ?? '?'} / ${r.status}`, (byKind.get(`${r.kind ?? '?'} / ${r.status}`) ?? 0) + 1);
  console.log('inbox now holds:');
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
  await stopOcr();
}

/** What the folder habit says a file is ("Shipping bill 75.pdf" → shipping_bill); null when unclear. */
function expectedFromName(file: string): string | null {
  const name = path.basename(file);
  const hits = INTAKE_KINDS.filter((k) => k.file?.test(name));
  return hits.length === 1 ? hits[0].key : null;
}

export async function accuracyReport(args: string[]) {
  const folder = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
  if (!folder) throw new Error('Usage: intake-accuracy <folder> [--limit N] [--out report.csv]');
  const limit = Number(flag(args, 'limit') ?? 300) || 300;
  const out = flag(args, 'out');
  const csv: string[] = ['file,expected,found,confidence,method,ocr,fields'];
  let n = 0;
  let judged = 0;
  let right = 0;
  const methods = new Map<string, number>();
  const confusion = new Map<string, number>();
  // export invoice pairs: the .xls is the truth, the PDF / scan is read and compared
  const invoiceTruth = new Map<string, Record<string, string>>();
  const invoiceRead: { dir: string; fields: Record<string, string> }[] = [];
  for await (const file of walk(folder)) {
    if (n >= limit) break;
    const buf = await readFile(file);
    const k = detectKind(buf, file);
    if (!k) continue;
    n++;
    const r = await readDocument(buf, k.kind, k.mime).catch(() => null);
    if (!r) continue;
    const c = classify(r.text, file);
    const x = extract(r.text, c.kind);
    methods.set(r.method, (methods.get(r.method) ?? 0) + 1);
    const expected = expectedFromName(file);
    if (expected) {
      judged++;
      if (expected === c.kind) right++;
      else confusion.set(`${expected} → ${c.kind}`, (confusion.get(`${expected} → ${c.kind}`) ?? 0) + 1);
    }
    const fv = Object.fromEntries(Object.entries(x.fields).map(([key, v]) => [key, v.value]));
    if (c.kind === 'export_invoice') {
      const dir = path.dirname(file);
      if (k.kind === 'xls' || k.kind === 'xlsx') invoiceTruth.set(dir, fv);
      else invoiceRead.push({ dir, fields: fv });
    }
    csv.push([path.relative(folder, file), expected ?? '', c.kind, c.confidence, r.method, r.ocrConfidence ?? '', Object.keys(x.fields).length].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    if (n % 20 === 0) console.log(`  read ${n} files…`);
  }
  await stopOcr();
  console.log(`\nread ${n} files (${[...methods.entries()].map(([m, c]) => `${c} ${m}`).join(', ')})`);
  console.log(`document type right: ${right}/${judged} where the file name says what it is (${judged ? Math.round((right / judged) * 100) : 0}%)`);
  for (const [k, v] of [...confusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  const keys = ['invoiceNumber', 'invoiceDate', 'amount', 'quantityMt', 'containerCount'];
  const score = Object.fromEntries(keys.map((k) => [k, { same: 0, total: 0 }]));
  for (const r of invoiceRead) {
    const truth = invoiceTruth.get(r.dir);
    if (!truth) continue;
    for (const k of keys) {
      if (!truth[k]) continue;
      score[k].total++;
      if (r.fields[k] && Number.isFinite(Number(truth[k])) ? Number(r.fields[k]) === Number(truth[k]) : r.fields[k] === truth[k]) score[k].same++;
    }
  }
  console.log('export invoice PDF / scan vs its Excel original:');
  for (const k of keys) console.log(`  ${k.padEnd(16)} ${score[k].same}/${score[k].total}`);
  if (out) {
    await writeFile(out, csv.join('\n'));
    console.log(`details: ${out}`);
  }
}
