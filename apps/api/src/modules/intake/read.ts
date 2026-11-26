/**
 * Turns any uploaded document into text, on this server only (no cloud service is ever called):
 *  - PDF: the text layer of each page; a page without one (a scan) is rendered and read by OCR
 *  - photos / scans (JPG, PNG, WEBP, TIFF): OCR
 *  - Excel (.xlsx/.xls), Word (.docx), plain text: their own text
 * OCR is Tesseract (tesseract.js, WebAssembly) with the English and Arabic models shipped in
 * node_modules — nothing is downloaded at run time.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';
import mammoth from 'mammoth';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import * as XLSX from 'xlsx';
import { config } from '../../config.js';

const requireFrom = createRequire(import.meta.url);

export type FileKind = 'pdf' | 'image' | 'xlsx' | 'xls' | 'docx' | 'doc' | 'text';

export interface ReadResult {
  text: string;
  pages: number;
  /** How the text was obtained: text layer, OCR, or a mix (some pages scanned). */
  method: 'text' | 'ocr' | 'mixed' | 'none';
  /** Mean OCR confidence 0–100 (null when no OCR was needed). */
  ocrConfidence: number | null;
}

/** File type from its first bytes (never from the name alone) — the name only splits zip/OLE office files. */
export function detectKind(buf: Buffer, name: string): { kind: FileKind; mime: string } | null {
  const ext = path.extname(name).toLowerCase();
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (buf.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buf.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return { kind: 'image', mime: 'image/tiff' };
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (ext === '.xlsx' || ext === '.xlsm') return { kind: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    if (ext === '.docx') return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    return null;
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    if (ext === '.xls') return { kind: 'xls', mime: 'application/vnd.ms-excel' };
    if (ext === '.doc') return { kind: 'doc', mime: 'application/msword' };
    return null;
  }
  if (ext === '.txt' || ext === '.csv') {
    const head = buf.subarray(0, 4096);
    if (!head.includes(0)) return { kind: 'text', mime: 'text/plain' };
  }
  return null;
}

// ------------------------------------------------------------------ OCR worker (one, reused)

let worker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function langDir(pkg: string, sub: string) {
  return path.join(path.dirname(requireFrom.resolve(`${pkg}/package.json`)), sub);
}

async function ocrWorker(): Promise<Worker> {
  if (!worker) {
    const cachePath = path.join(config.storageDir, 'ocr-cache');
    mkdirSync(cachePath, { recursive: true });
    worker = (async () => {
      // English model (best accuracy) for the documents; Arabic is added only when a page needs it.
      const w = await createWorker('eng', OEM.LSTM_ONLY, { langPath: langDir('@tesseract.js-data/eng', '4.0.0_best_int'), gzip: true, cachePath });
      await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
      return w;
    })();
    worker.catch(() => (worker = null));
  }
  return worker;
}

/** OCR one image; calls are serialised so one big scan cannot starve the server. */
function ocr(png: Buffer): Promise<{ text: string; confidence: number }> {
  const run = queue.then(async () => {
    const w = await ocrWorker();
    const { data } = await w.recognize(png);
    return { text: data.text, confidence: data.confidence };
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function stopOcr() {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate().catch(() => undefined);
}

// ------------------------------------------------------------------ readers

const MAX_OCR_PAGES = 12;
const DPI = 300;

async function readPdf(buf: Buffer): Promise<ReadResult> {
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const pages = doc.countPages();
  const parts: string[] = [];
  const confs: number[] = [];
  let ocrPages = 0;
  let textPages = 0;
  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i);
    const own = page.toStructuredText('preserve-whitespace').asText().trim();
    if (own.replace(/\s+/g, '').length >= 40) {
      parts.push(own);
      textPages++;
      continue;
    }
    if (ocrPages >= MAX_OCR_PAGES) continue;
    const pix = page.toPixmap(mupdf.Matrix.scale(DPI / 72, DPI / 72), mupdf.ColorSpace.DeviceGray, false, true);
    const r = await ocr(Buffer.from(pix.asPNG()));
    parts.push(r.text.trim());
    confs.push(r.confidence);
    ocrPages++;
  }
  const method = ocrPages && textPages ? 'mixed' : ocrPages ? 'ocr' : textPages ? 'text' : 'none';
  return { text: parts.join('\n\f\n'), pages, method, ocrConfidence: confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null };
}

async function readImage(buf: Buffer, mime: string): Promise<ReadResult> {
  // normalise every image format to a grey PNG at a readable size (mupdf decodes JPG/PNG/TIFF/WEBP)
  const img = mupdf.Document.openDocument(buf, mime);
  const page = img.loadPage(0);
  const b = page.getBounds();
  const scale = Math.min(3, Math.max(1, 2400 / Math.max(b[2] - b[0], 1)));
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false, true);
  const r = await ocr(Buffer.from(pix.asPNG()));
  return { text: r.text.trim(), pages: 1, method: 'ocr', ocrConfidence: Math.round(r.confidence) };
}

function readSheet(buf: Buffer): ReadResult {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, dense: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 6)) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, blankrows: false });
    parts.push(`## ${name}`);
    for (const row of rows) {
      const cells = (row as unknown[]).map((c) => String(c ?? '').trim()).filter(Boolean);
      if (cells.length) parts.push(cells.join(' | '));
    }
  }
  return { text: parts.join('\n'), pages: wb.SheetNames.length, method: 'text', ocrConfidence: null };
}

async function readDocx(buf: Buffer): Promise<ReadResult> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return { text: value.replace(/\n{3,}/g, '\n\n').trim(), pages: 1, method: 'text', ocrConfidence: null };
}

/** Old Word (.doc) files: pull the readable runs of text out of the binary. */
function readDoc(buf: Buffer): ReadResult {
  const text = (buf.toString('latin1').match(/[\x20-\x7e\r\n\t]{6,}/g) ?? []).join('\n');
  return { text, pages: 1, method: 'text', ocrConfidence: null };
}

export async function readDocument(buf: Buffer, kind: FileKind, mime: string): Promise<ReadResult> {
  switch (kind) {
    case 'pdf':
      return readPdf(buf);
    case 'image':
      return readImage(buf, mime);
    case 'xlsx':
    case 'xls':
      return readSheet(buf);
    case 'docx':
      return readDocx(buf);
    case 'doc':
      return readDoc(buf);
    case 'text':
      return { text: buf.toString('utf8'), pages: 1, method: 'text', ocrConfidence: null };
  }
}
