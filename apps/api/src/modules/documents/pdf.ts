/**
 * Print-ready A4 PDFs for sales documents (layouts ported from the PR's PdfService).
 *
 * Everything printed comes from the database: the company profile (legal name, address,
 * registrations, logo or letterhead, signature, seal, signatory) and the document itself.
 * Nothing is hard-coded; a missing value prints as "-" or its block is left out.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { add, containerCount, CONTAINER_FIELDS, fillTemplate, formatAmount, round, type DocDef } from '@rmm/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { config } from '../../config.js';
import type { Tx } from '../../db/client.js';
import { files, masterTables } from '../../db/schema/index.js';
import type { RequestContext } from '../../core/context.js';
import { getDocument, resolveDoc } from './documents.service.js';

type Row = Record<string, unknown>;
type Doc = PDFKit.PDFDocument;

const LEFT = 36;
const RIGHT = 559;
const MIDX = 300;
const BOTTOM = 842 - 70; // keep clear of the footer
const GRAY = '#555555';
const DARK = '#111111';
const ACCENT = '#13529c';
const RULE = '#b7c6da';

// ------------------------------------------------------------------ data
interface Party {
  name: string;
  lines: string[];
}

interface Images {
  logo: Buffer | null;
  letterhead: Buffer | null;
  footer: Buffer | null;
  signature: Buffer | null;
  seal: Buffer | null;
}

interface PrintData {
  def: DocDef;
  doc: Row & { lines: Row[]; terms: Row[]; containers: Row[] };
  company: Row;
  companyLines: string[];
  images: Images;
  parties: { buyer: Party | null; consignee: Party | null; notify: Party | null };
  bank: Row | null;
  currency: { code: string; symbol: string };
  companyCountry: string | null;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dash = (v: unknown) => str(v).trim() || '-';

export function formatDate(v: unknown): string {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date(`${s}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Image bytes for a stored file, if it is a PNG or JPEG (the formats PDFKit can embed). */
async function image(tx: Tx, id: unknown): Promise<Buffer | null> {
  if (typeof id !== 'string') return null;
  const [f] = await tx.select().from(files).where(eq(files.id, id));
  if (!f || !['image/png', 'image/jpeg'].includes(f.mimeType)) return null;
  const abs = path.resolve(config.storageDir, f.storagePath);
  if (!abs.startsWith(config.storageDir + path.sep)) return null;
  return readFile(abs).catch(() => null);
}

async function partyOf(tx: Tx, id: unknown): Promise<Party | null> {
  if (typeof id !== 'string') return null;
  const c = masterTables.customers;
  const [p] = (await tx.select().from(c).where(eq(c.id, id))) as Row[];
  if (!p) return null;
  const country = await nameOf(tx, 'countries', p.countryId);
  return {
    name: str(p.name),
    lines: [str(p.address), [p.city, country].filter(Boolean).join(', '), p.taxId ? `VAT / Tax No.: ${p.taxId}` : '', p.phone ? `Tel: ${p.phone}` : '', p.email ? str(p.email) : '']
      .flatMap((l) => l.split(/\r?\n/))
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

async function nameOf(tx: Tx, entity: string, id: unknown): Promise<string | null> {
  if (typeof id !== 'string') return null;
  const t = masterTables[entity];
  const [r] = await tx.select({ name: t.name }).from(t).where(eq(t.id, id));
  return (r?.name as string) ?? null;
}

export async function loadPrintData(tx: Tx, ctx: RequestContext, key: string, id: string): Promise<PrintData> {
  const { def } = resolveDoc(key);
  const doc = (await getDocument(tx, ctx, key, id, 'print')) as PrintData['doc'];
  const co = masterTables.companies;
  const [company] = (await tx.select().from(co).where(eq(co.id, ctx.companyId!))) as Row[];
  const companyCountry = await nameOf(tx, 'countries', company.countryId);
  // Exporter block shows only name + address; contacts (Tel/Email/GSTIN/IEC) live in the footer.
  const companyLines = [
    str(company.addressLine1),
    str(company.addressLine2),
    [company.city, company.state, company.pincode].filter(Boolean).join(', '),
    companyCountry ?? '',
  ].filter((l) => l.trim());

  const [logo, letterhead, footer, signature, seal] = await Promise.all(
    [company.logoFileId, company.letterheadFileId, company.footerFileId, company.signatureFileId, company.sealFileId].map((fid) => image(tx, fid)),
  );
  let bank: Row | null = null;
  if (typeof doc.bankAccountId === 'string') {
    const b = masterTables.bankAccounts;
    [bank] = (await tx.select().from(b).where(and(eq(b.id, doc.bankAccountId), isNull(b.deletedAt)))) as Row[];
  }
  const cur = masterTables.currencies;
  const [currency] = typeof doc.currencyId === 'string' ? await tx.select({ code: cur.code, symbol: cur.symbol }).from(cur).where(eq(cur.id, doc.currencyId)) : [];
  return {
    def,
    doc,
    company,
    companyLines,
    companyCountry,
    images: { logo, letterhead, footer, signature, seal },
    parties: {
      buyer: await partyOf(tx, doc.buyerId),
      consignee: await partyOf(tx, doc.consigneeId),
      notify: await partyOf(tx, doc.notifyPartyId),
    },
    bank: bank ?? null,
    currency: { code: str(currency?.code) || '', symbol: str(currency?.symbol) || str(currency?.code) },
  };
}

/** Group the lines by product card (packGroup); unset/0 groups stay as their own single line. */
function groupLines(lines: Row[]): Row[][] {
  const groups: Row[][] = [];
  const byKey = new Map<number, Row[]>();
  let auto = -1;
  for (const l of lines) {
    const g = Number(l.packGroup) || 0;
    const k = g > 0 ? g : auto--;
    let arr = byKey.get(k);
    if (!arr) {
      arr = [];
      byKey.set(k, arr);
      groups.push(arr);
    }
    arr.push(l);
  }
  return groups;
}

/** Product master descriptions for printed lines (name + "description on documents"). */
async function productTexts(tx: Tx, lines: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => typeof x === 'string'))];
  if (!ids.length) return new Map();
  const p = masterTables.products;
  const rows = await tx.select({ id: p.id, d: p.invoiceDescription }).from(p).where(inArray(p.id, ids));
  return new Map(rows.filter((r) => r.d).map((r) => [r.id as string, r.d as string]));
}

// ------------------------------------------------------------------ drawing helpers
class Writer {
  y = 0;
  constructor(
    readonly pdf: Doc,
    private readonly data: PrintData,
    private readonly title: string,
  ) {}

  /** Starts a new page with the header when fewer than `need` points are left. */
  ensure(need: number) {
    if (this.y + need > BOTTOM) {
      this.pdf.addPage();
      this.header(true);
    }
  }

  header(continued = false) {
    const { pdf, data } = this;
    const { letterhead, logo } = data.images;
    let y = 30;
    if (letterhead) {
      // Span the full content column (same left/right margin as the body), proportional height.
      const w = RIGHT - LEFT;
      let h = 96;
      try {
        const img = pdf.openImage(letterhead);
        h = Math.min((img.height / img.width) * w, 150);
      } catch {
        /* keep the default height */
      }
      pdf.image(letterhead, LEFT, y, { fit: [w, h], align: 'center' });
      y += h + 16; // clear space under the letterhead, above the title
    } else if (logo) {
      pdf.image(logo, RIGHT - 120, y, { fit: [120, 54], align: 'right' });
    }
    pdf.font('Helvetica-Bold').fontSize(15).fillColor(DARK).text(this.title + (continued ? ' (continued)' : ''), LEFT, letterhead ? y : 40, { width: RIGHT - LEFT, align: 'center' });
    // more breathing room under the title on letterhead documents (certificates)
    this.y = Math.max(pdf.y + (letterhead ? 18 : 6), letterhead ? y : 90);
    if (continued) {
      pdf.font('Helvetica').fontSize(8).fillColor(GRAY).text(`${data.def.label} ${data.doc.documentNumber}`, LEFT, this.y, { width: RIGHT - LEFT, align: 'center' });
      this.y = pdf.y + 8;
    }
  }

  heading(text: string, x: number, w: number, y = this.y): number {
    this.pdf.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT).text(text, x, y, { width: w });
    const ly = this.pdf.y + 2;
    this.pdf.moveTo(x, ly).lineTo(x + w, ly).lineWidth(0.5).stroke(RULE);
    return ly + 3;
  }

  rule(color = '#999999', width = 0.6) {
    this.pdf.moveTo(LEFT, this.y).lineTo(RIGHT, this.y).lineWidth(width).stroke(color);
  }

  kv(rows: [string, unknown][], x: number, w: number, y: number, labelW = 100): number {
    let ry = y;
    for (const [k, v] of rows) {
      this.pdf.font('Helvetica').fontSize(8).fillColor(GRAY).text(k, x, ry, { width: labelW });
      this.pdf.font('Helvetica-Bold').fontSize(8.3).fillColor(DARK).text(dash(v), x + labelW + 6, ry, { width: w - labelW - 6 });
      ry = Math.max(this.pdf.y, ry + 12);
    }
    return ry;
  }

  party(title: string, p: Party | null, x: number, w: number, y: number): number {
    let py = this.heading(title, x, w, y);
    if (!p) {
      this.pdf.font('Helvetica').fontSize(8.3).fillColor(GRAY).text('-', x, py);
      return this.pdf.y;
    }
    this.pdf.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(p.name, x, py, { width: w });
    py = this.pdf.y + 1;
    this.pdf.font('Helvetica').fontSize(8.2).fillColor(DARK).text(p.lines.join('\n'), x, py, { width: w, lineGap: 1 });
    return this.pdf.y;
  }

  exporter(x: number, w: number, y: number, title = 'EXPORTER'): number {
    const { company, companyLines } = this.data;
    let ey = this.heading(title, x, w, y);
    this.pdf.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(str(company.legalName) || str(company.name), x, ey, { width: w });
    ey = this.pdf.y + 1;
    this.pdf.font('Helvetica').fontSize(8.2).fillColor(DARK).text(companyLines.join('\n'), x, ey, { width: w, lineGap: 1 });
    return this.pdf.y;
  }

  terms(terms: Row[], title = 'TERMS & CONDITIONS') {
    if (!terms.length) return;
    this.ensure(40);
    this.y = this.heading(title, LEFT, RIGHT - LEFT) + 1;
    this.pdf.font('Helvetica').fontSize(7.8).fillColor(DARK);
    terms.forEach((t, i) => {
      const text = `${i + 1}. ${str(t.content)}`;
      this.ensure(this.pdf.heightOfString(text, { width: RIGHT - LEFT }) + 2);
      this.pdf.font('Helvetica').fontSize(7.8).fillColor(DARK).text(text, LEFT, this.y, { width: RIGHT - LEFT });
      this.y = this.pdf.y + 2;
    });
    this.y += 6;
  }

  /** "For COMPANY" + signature and seal images + signatory name/designation. */
  signature(x: number, w: number, y: number): number {
    const { company, images } = this.data;
    const { pdf } = this;
    pdf.font('Helvetica-Bold').fontSize(8).fillColor(DARK).text(`For ${(str(company.legalName) || str(company.name)).toUpperCase()}`, x, y, { width: w, align: 'center' });
    const top = pdf.y + 4;
    const boxH = 56;
    if (images.seal) pdf.image(images.seal, x + w / 2 - 75, top - 4, { fit: [64, 64] });
    if (images.signature) pdf.image(images.signature, x + w / 2 - 50, top, { fit: [130, boxH - 8], align: 'center', valign: 'center' });
    let sy = top + boxH;
    if (company.signatoryName) {
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(DARK).text(str(company.signatoryName), x, sy, { width: w, align: 'center' });
      sy = pdf.y;
    }
    pdf.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(str(company.signatoryDesignation) || 'Authorised Signatory', x, sy, { width: w, align: 'center' });
    return pdf.y;
  }

  /** Faint diagonal watermark (e.g. DRAFT) across every page. */
  watermark(text: string) {
    const { pdf } = this;
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      pdf.save();
      pdf.rotate(-45, { origin: [297, 421] });
      pdf.font('Helvetica-Bold').fontSize(90).fillColor('#e23b3b').opacity(0.1).text(text, 0, 380, { width: 594, align: 'center' });
      pdf.opacity(1).restore();
    }
  }

  /** Company footer (name, address, contacts) on every page, plus page numbers. */
  footers() {
    const { pdf, data } = this;
    const { company, companyCountry } = data;
    const name = str(company.legalName) || str(company.name);
    const address = [str(company.addressLine1), str(company.addressLine2), [company.city, company.state, company.pincode].map(str).filter(Boolean).join(', '), companyCountry ?? '']
      .map((l) => l.trim())
      .filter(Boolean)
      .join(', ');
    const contacts = [
      company.email ? `Email: ${str(company.email)}` : '',
      company.phone ? `Phone: ${str(company.phone)}` : '',
      company.gstin ? `GSTIN: ${str(company.gstin)}` : '',
      company.iec ? `IEC: ${str(company.iec)}` : '',
    ]
      .filter(Boolean)
      .join('    |    ');
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      // footers sit inside the bottom margin; without this PDFKit would start a new page
      pdf.page.margins.bottom = 0;
      const page = `Page ${i - range.start + 1} of ${range.count}`;
      if (data.images.footer) {
        pdf.image(data.images.footer, LEFT, 842 - 58, { fit: [RIGHT - LEFT, 34], align: 'center' });
        pdf.font('Helvetica').fontSize(7).fillColor(GRAY).text(page, LEFT, 842 - 18, { width: RIGHT - LEFT, align: 'right', lineBreak: false });
        continue;
      }
      let fy = 842 - 64;
      pdf.moveTo(LEFT, fy - 5).lineTo(RIGHT, fy - 5).lineWidth(0.5).stroke(RULE);
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(DARK).text(name, LEFT, fy, { width: RIGHT - LEFT, align: 'center', lineBreak: false });
      fy = pdf.y + 1;
      if (address) {
        pdf.font('Helvetica').fontSize(6.6).fillColor(GRAY).text(address, LEFT, fy, { width: RIGHT - LEFT, align: 'center', lineBreak: false });
        fy = pdf.y + 1;
      }
      if (contacts) {
        pdf.font('Helvetica').fontSize(6.6).fillColor(GRAY).text(contacts, LEFT, fy, { width: RIGHT - LEFT, align: 'center', lineBreak: false });
        fy = pdf.y + 1;
      }
      pdf.font('Helvetica').fontSize(6.6).fillColor(GRAY).text(page, LEFT, fy + 1, { width: RIGHT - LEFT, align: 'center', lineBreak: false });
    }
  }
}

function render(build: (w: Writer, pdf: Doc) => void, data: PrintData, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, info: { Title: `${title} ${str(data.doc.documentNumber)}`, Author: str(data.company.legalName) } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    try {
      const w = new Writer(pdf, data, title);
      w.header();
      build(w, pdf);
      w.footers();
      pdf.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * "23 X 20' FCL SAID TO CONTAIN": the override if set, else built from the chosen container
 * type (master) and the number of containers, else from the container list's sizes.
 */
function saidToContain(doc: Row & { containers?: Row[] }): string {
  const override = str(doc.saidToContain).trim();
  if (override) return override.toUpperCase();
  const containers = (doc.containers as Row[]) ?? [];
  // Use the editable "No. of containers" box if filled; otherwise the count worked out from
  // each packing's weight and its per-container capacity; otherwise the packing-list count.
  const manual = Number(doc.noOfContainers);
  const count = (manual > 0 ? manual : containerCount((doc.lines as Row[]) ?? [])) || containers.length;
  const typeLabel = str(doc.containerTypeIdLabel).trim();
  if (typeLabel) return `${count ? `${count} X ` : ''}${typeLabel} SAID TO CONTAIN`.toUpperCase();
  if (count && !containers.length) return `${count} X 20' FCL SAID TO CONTAIN`;
  if (!count) return '';
  const counts = new Map<string, number>();
  for (const c of containers) {
    const s = str(c.containerSize) || '20FT';
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const sizeLabel = (s: string) => (s === '40HC' ? "40' HC" : s === '40FT' ? "40'" : "20'");
  return `${[...counts.entries()].map(([s, n]) => `${n} X ${sizeLabel(s)}`).join(' + ')} FCL SAID TO CONTAIN`;
}

/**
 * Goods table shared by PI and commercial invoice. Lines are grouped by product card
 * (a product can ship in several packings); each packing prints its own HS code, bags,
 * quantity, rate and amount under the product heading.
 */
function goodsTable(w: Writer, data: PrintData, descriptions: Map<string, string>, opts: { qtyLabel: string; showBags?: boolean }) {
  const { pdf } = w;
  const cur = data.currency.code;
  const showBags = opts.showBags !== false;
  // Evenly pitched columns (62 pt apart) with the HS-code column removed; the number columns
  // are right-aligned and spread across the right half instead of bunched together.
  const col = { sno: LEFT, desc: LEFT + 22, bags: 311, qty: 373, rate: 435, amt: 497 };
  const NW = 58; // right-aligned number width
  const descW = col.bags - col.desc - 8;
  const packW = col.bags - (col.desc + 8) - 8;
  const head = () => {
    pdf.font('Helvetica-Bold').fontSize(7.8).fillColor(GRAY);
    pdf.text('S.No', col.sno, w.y, { width: 20 });
    pdf.text('Description of goods', col.desc, w.y, { width: descW });
    if (showBags) pdf.text('Bags', col.bags, w.y, { width: NW, align: 'right' });
    pdf.text(opts.qtyLabel, col.qty, w.y, { width: NW, align: 'right' });
    pdf.text(`Rate ${cur}/MT`, col.rate, w.y, { width: NW, align: 'right' });
    pdf.text(`Amount ${cur}`, col.amt, w.y, { width: RIGHT - col.amt, align: 'right' });
    w.y = pdf.y + 3;
    w.rule('#6f7f93', 0.7);
    w.y += 4;
  };
  const figures = (l: Row, amt: unknown, top: number) => {
    pdf.font('Helvetica').fontSize(8.3).fillColor(DARK);
    if (showBags) pdf.text(Number(l.noOfBags) > 0 ? String(l.noOfBags) : '-', col.bags, top, { width: NW, align: 'right' });
    pdf.text(round(str(l.quantityMt), 3), col.qty, top, { width: NW, align: 'right' });
    pdf.text(formatAmount(str(l.ratePerMt)), col.rate, top, { width: NW, align: 'right' });
    pdf.text(formatAmount(str(amt)), col.amt, top, { width: RIGHT - col.amt, align: 'right' });
  };
  const packLabel = (l: Row) => [l.packingText ? `Packing: ${str(l.packingText)}` : l.packingTypeIdLabel ? `Packing: ${str(l.packingTypeIdLabel)}` : '', str(l.packingNote)].filter(Boolean).join('\n');

  // Product heading: name (bold) → brand (bold) → master description / spec / crop year.
  // The product itself carries no serial number; each packing under it is numbered instead.
  // (HS code is printed once, just above the total net weight — not inside the table.)
  const describe = (main: Row, x: number, width: number): number => {
    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(str(main.productIdLabel), x, pdf.y, { width });
    if (str(main.brand).trim()) pdf.font('Helvetica-Bold').fontSize(7.8).fillColor(DARK).text(`Brand: ${str(main.brand).trim()}`, x, pdf.y, { width });
    const rest = [descriptions.get(str(main.productId)), str(main.specifications), main.cropYear ? `Crop year: ${main.cropYear}` : ''].filter(Boolean).join('\n');
    if (rest) pdf.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(rest, x, pdf.y, { width });
    return pdf.y;
  };
  const headingHeight = (main: Row, width: number): number => {
    let h = pdf.font('Helvetica-Bold').fontSize(8.5).heightOfString(str(main.productIdLabel), { width });
    if (str(main.brand).trim()) h += pdf.font('Helvetica-Bold').fontSize(7.8).heightOfString(`Brand: ${str(main.brand).trim()}`, { width });
    const rest = [descriptions.get(str(main.productId)), str(main.specifications), main.cropYear ? `Crop year: ${main.cropYear}` : ''].filter(Boolean).join('\n');
    if (rest) h += pdf.font('Helvetica').fontSize(7.5).heightOfString(rest, { width });
    return h;
  };

  w.ensure(60);
  head();
  for (const group of groupLines(data.doc.lines)) {
    const main = group[0];
    if (w.y + headingHeight(main, descW) + group.length * 14 + 12 > BOTTOM) {
      pdf.addPage();
      w.header(true);
      head();
    }
    pdf.y = w.y;
    w.y = describe(main, col.desc, descW) + 3;
    // one numbered row per packing (bags / net weight / rate / amount)
    for (const [j, l] of group.entries()) {
      if (w.y + 16 > BOTTOM) {
        pdf.addPage();
        w.header(true);
        head();
      }
      const ry = w.y;
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(DARK).text(String(j + 1), col.sno, ry, { width: 20 });
      pdf.font('Helvetica').fontSize(8).fillColor(DARK).text(packLabel(l) || 'Packing', col.desc + 8, ry, { width: packW });
      const bottom = pdf.y;
      figures(l, l.amount, ry);
      w.y = Math.max(bottom, ry + 12) + 3;
    }
    w.y += 4;
  }
  w.rule('#6f7f93', 0.7);
  w.y += 6;
}

function totalsBlock(w: Writer, rows: [string, string, boolean?][]) {
  w.ensure(rows.length * 14 + 10);
  for (const [k, v, bold] of rows) {
    w.pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9.5 : 8.4).fillColor(DARK).text(k, 330, w.y, { width: 150 });
    w.pdf.text(v, 470, w.y, { width: RIGHT - 470, align: 'right' });
    w.y += bold ? 16 : 13;
  }
}

function words(w: Writer, text: unknown) {
  if (!text) return;
  w.ensure(24);
  w.pdf.font('Helvetica-Bold').fontSize(8.3).fillColor(DARK).text('AMOUNT IN WORDS: ', LEFT, w.y, { continued: true, width: RIGHT - LEFT }).font('Helvetica').text(str(text));
  w.y = w.pdf.y + 8;
}

function bankBlock(w: Writer, bank: Row | null, x: number, width: number, y: number): number {
  const by = w.heading('BANK DETAILS (FOR REMITTANCE)', x, width, y);
  if (!bank) return w.kv([['Bank', '-']], x, width, by, 80);
  return w.kv(
    [
      ['Beneficiary', bank.accountName],
      ['Bank', [bank.bankName, bank.branch].filter(Boolean).join(', ')],
      ['Account no.', bank.accountNumber],
      ['SWIFT', bank.swiftCode],
      ['IFSC / AD code', [bank.ifsc, bank.adCode].filter(Boolean).join(' / ')],
      ...(bank.iban ? ([['IBAN', bank.iban]] as [string, unknown][]) : []),
      ...(bank.intermediaryBank ? ([['Intermediary bank', bank.intermediaryBank]] as [string, unknown][]) : []),
    ],
    x,
    width,
    by,
    80,
  );
}

// ------------------------------------------------------------------ documents
function proforma(data: PrintData, descriptions: Map<string, string>) {
  const d = data.doc;
  return render(
    (w) => {
      const ey = w.exporter(LEFT, 250, w.y);
      const dy = w.kv(
        [
          ['PI no.', d.documentNumber],
          ['PI date', formatDate(d.documentDate)],
          ...(d.buyerPoRef ? ([["Buyer's PO / ref", d.buyerPoRef]] as [string, unknown][]) : []),
          ...(d.poDate ? ([['PO date', formatDate(d.poDate)]] as [string, unknown][]) : []),
          ...(d.showLcDetails ? ([['LC no.', d.lcNumber], ['LC date', formatDate(d.lcDate)]] as [string, unknown][]) : []),
          ['Currency', data.currency.code],
          ['Incoterm', d.incoterm],
          ['Payment terms', d.paymentTerms || d.paymentTermIdLabel],
        ],
        MIDX,
        RIGHT - MIDX,
        w.heading('PROFORMA INVOICE DETAILS', MIDX, RIGHT - MIDX),
        90,
      );
      w.y = Math.max(ey, dy) + 8;
      const cY = w.party('BUYER', data.parties.buyer, LEFT, 250, w.y);
      const bY = w.party('CONSIGNEE', data.parties.consignee ?? data.parties.buyer, MIDX, RIGHT - MIDX, w.y);
      w.y = Math.max(cY, bY) + 8;
      if (d.showNotifyParty && data.parties.notify) w.y = w.party('NOTIFY PARTY', data.parties.notify, LEFT, 250, w.y) + 8;
      if (d.showShippingDetails) {
        w.ensure(70);
        const sy = w.heading('SHIPPING DETAILS', LEFT, RIGHT - LEFT);
        const l = w.kv([['Country of origin', d.originCountryIdLabel], ['Port of loading', d.portOfLoadingIdLabel], ['Mode of shipment', d.modeOfShipment]], LEFT, 250, sy);
        const r = w.kv([['Destination country', d.destinationCountryIdLabel], ['Port of discharge', d.portOfDischargeIdLabel], ['Final destination', d.finalDestination], ['Shipment', d.deliveryTimeline]], MIDX, RIGHT - MIDX, sy);
        w.y = Math.max(l, r) + 8;
      }
      if (d.showSpecification && (d.specVariety || d.specAvgLengthMm || d.specMoisturePct || d.specBrokenPct || d.specCropYear || d.brand)) {
        w.ensure(60);
        const sy = w.heading('SPECIFICATION', LEFT, RIGHT - LEFT);
        const l = w.kv([['Variety & grade', d.specVariety], ['Avg. grain length', d.specAvgLengthMm ? `${d.specAvgLengthMm} mm` : ''], ['Crop year', d.specCropYear]], LEFT, 250, sy);
        const r = w.kv([['Moisture (max)', d.specMoisturePct ? `${d.specMoisturePct}%` : ''], ['Broken (max)', d.specBrokenPct ? `${d.specBrokenPct}%` : ''], ['Brand / blend', [d.brand, d.blend].filter(Boolean).join(' / ')]], MIDX, RIGHT - MIDX, sy);
        w.y = Math.max(l, r) + 8;
      }
      goodsTable(w, data, descriptions, { qtyLabel: 'Qty (MT)' });
      w.pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(`Total quantity: ${round(str(d.totalQuantityMt), 3)} MT`, LEFT, w.y, { width: 260 });
      totalsBlock(w, [
        [`${d.incoterm} goods value`, formatAmount(str(d.goodsAmount))],
        ...(Number(d.freightAmount) ? ([['Freight', formatAmount(str(d.freightAmount))]] as [string, string][]) : []),
        ...(Number(d.insuranceAmount) ? ([['Insurance', formatAmount(str(d.insuranceAmount))]] as [string, string][]) : []),
        ...(Number(d.discountAmount) ? ([['Discount (-)', formatAmount(str(d.discountAmount))]] as [string, string][]) : []),
        [`TOTAL (${data.currency.code})`, formatAmount(str(d.grandTotal)), true],
      ]);
      words(w, d.amountInWords);
      if (d.showBankDetails) {
        w.ensure(80);
        w.y = bankBlock(w, data.bank, LEFT, RIGHT - LEFT, w.y) + 8;
      }
      if (d.showTermsConditions) w.terms(d.terms);
      if (d.showSignatureBlock) {
        w.ensure(110);
        const top = w.y + 6;
        w.pdf.font('Helvetica').fontSize(8).fillColor(DARK).text(`Accepted by: ${data.parties.buyer?.name ?? ''}`, LEFT, top, { width: 250 });
        w.pdf.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Signature, name and company stamp', LEFT, top + 70, { width: 250 });
        w.y = w.signature(MIDX, RIGHT - MIDX, top) + 6;
      }
    },
    data,
    'PROFORMA INVOICE',
  );
}

function productionOrder(data: PrintData, descriptions: Map<string, string>) {
  const d = data.doc;
  return render(
    (w) => {
      const ey = w.exporter(LEFT, 250, w.y);
      const ry = w.kv(
        [
          ['Order no.', d.documentNumber],
          ['Date', formatDate(d.documentDate)],
          ['Against PI', d.proformaInvoiceIdLabel],
          ['Mill / supplier', d.supplierIdLabel],
          ['Buyer', d.buyerIdLabel],
          ["Buyer's PO", d.buyerPoRef],
          ['Dispatch by', formatDate(d.dispatchSchedule)],
        ],
        MIDX,
        RIGHT - MIDX,
        w.heading('PRODUCTION ORDER DETAILS', MIDX, RIGHT - MIDX),
        90,
      );
      w.y = Math.max(ey, ry) + 8;
      w.ensure(60);
      const sy = w.heading('SPECIFICATION', LEFT, RIGHT - LEFT);
      const l = w.kv([['Variety & grade', d.specVariety], ['Avg. grain length', d.specAvgLengthMm ? `${d.specAvgLengthMm} mm` : ''], ['Crop year', d.specCropYear]], LEFT, 250, sy);
      const r = w.kv([['Moisture (max)', d.specMoisturePct ? `${d.specMoisturePct}%` : ''], ['Broken (max)', d.specBrokenPct ? `${d.specBrokenPct}%` : ''], ['Brand', d.brand]], MIDX, RIGHT - MIDX, sy);
      w.y = Math.max(l, r) + 8;

      const { pdf } = w;
      const col = { sno: LEFT, desc: LEFT + 24, pack: 330, bags: 430, qty: 490 };
      const head = () => {
        pdf.font('Helvetica-Bold').fontSize(8).fillColor(GRAY);
        pdf.text('S.No', col.sno, w.y, { width: 22 });
        pdf.text('Variety / description', col.desc, w.y);
        pdf.text('Packing', col.pack, w.y, { width: 96 });
        pdf.text('Bags', col.bags, w.y, { width: 55, align: 'right' });
        pdf.text('Net (MT)', col.qty, w.y, { width: RIGHT - col.qty, align: 'right' });
        w.y = pdf.y + 3;
        w.rule('#777777');
        w.y += 4;
      };
      w.ensure(50);
      head();
      for (const [i, it] of d.lines.entries()) {
        const extra = [descriptions.get(str(it.productId)), str(it.specifications), it.brokenBelow ? 'Broken below specification' : ''].filter(Boolean).join('\n');
        if (w.y + 30 > BOTTOM) {
          pdf.addPage();
          w.header(true);
          head();
        }
        const top = w.y;
        pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(String(i + 1), col.sno, top, { width: 22 });
        pdf.text(str(it.productIdLabel), col.desc, top, { width: col.pack - col.desc - 6 });
        if (extra) pdf.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(extra, col.desc, pdf.y, { width: col.pack - col.desc - 6 });
        const bottom = pdf.y;
        pdf.font('Helvetica').fontSize(8.5).fillColor(DARK);
        pdf.text(str(it.packingText) || str(it.packingTypeIdLabel) || '-', col.pack, top, { width: 96 });
        const packBottom = pdf.y;
        pdf.text(String(it.noOfBags ?? 0), col.bags, top, { width: 55, align: 'right' });
        pdf.text(round(str(it.quantityMt), 3), col.qty, top, { width: RIGHT - col.qty, align: 'right' });
        w.y = Math.max(bottom, packBottom, top + 12) + 4;
      }
      w.rule('#777777');
      w.y += 5;
      pdf.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(`Total quantity: ${round(str(d.totalQuantityMt), 3)} MT     Total bags: ${d.totalBags}`, LEFT, w.y);
      w.y = pdf.y + 10;
      const instructions = [
        d.millingInstructions ? `Milling: ${d.millingInstructions}` : '',
        d.packagingInstructions ? `Packaging: ${d.packagingInstructions}` : '',
        d.transport || d.vehicleNo ? `Transport: ${[d.transport, d.vehicleNo].filter(Boolean).join(' / ')}` : '',
        d.orderRemark ? `Remarks: ${d.orderRemark}` : '',
      ].filter(Boolean);
      if (instructions.length) {
        w.ensure(40);
        w.y = w.heading('INSTRUCTIONS', LEFT, RIGHT - LEFT);
        pdf.font('Helvetica').fontSize(8.5).fillColor(DARK).text(instructions.join('\n'), LEFT, w.y, { width: RIGHT - LEFT });
        w.y = pdf.y + 8;
      }
      w.terms(d.terms);
      if (d.showSignature) {
        w.ensure(100);
        w.y = w.signature(MIDX, RIGHT - MIDX, w.y + 10) + 6;
      }
    },
    data,
    'PRODUCTION ORDER',
  );
}

function commercialInvoice(data: PrintData, descriptions: Map<string, string>) {
  const d = data.doc;
  const cur = data.currency.code;
  const on = (flag: string) => d[flag] !== false; // optional sections default on
  const vessel = on('includeVessel');
  const charges = on('includeShippingCharges');
  const stage = str(d.invoiceStage) || 'DRAFT';
  return render(
    (w) => {
      const { pdf } = w;
      const RW = RIGHT - MIDX;
      const ey = w.exporter(LEFT, MIDX - LEFT - 12, w.y, 'SHIPPER / EXPORTER / MANUFACTURER');
      const ry = w.kv(
        [
          ['Invoice no.', d.documentNumber],
          ['Date', formatDate(d.documentDate)],
          ['IEC no.', data.company.iec],
          ...(d.productionOrderIdLabel || d.orderRefText ? ([['Against order', d.productionOrderIdLabel || d.orderRefText]] as [string, unknown][]) : []),
          ...(d.proformaInvoiceIdLabel || d.piRefText ? ([['Against PI', d.proformaInvoiceIdLabel || d.piRefText]] as [string, unknown][]) : []),
          ["Buyer's order & date", [d.buyerPoRef, formatDate(d.poDate)].filter(Boolean).join(' / ')],
          ...(on('includeLc') && d.lcNumber ? ([['LC no. & date', [d.lcNumber, formatDate(d.lcDate)].filter(Boolean).join(' / ')]] as [string, unknown][]) : []),
          ['Currency', cur],
        ],
        MIDX,
        RW,
        w.heading('INVOICE DETAILS', MIDX, RW),
        104,
      );
      w.y = Math.max(ey, ry) + 8;
      const cY = w.party('CONSIGNEE', data.parties.consignee ?? data.parties.buyer, LEFT, MIDX - LEFT - 12, w.y);
      const bY = w.party('BUYER (IF OTHER THAN CONSIGNEE)', data.parties.consignee ? data.parties.buyer : null, MIDX, RW, w.y);
      w.y = Math.max(cY, bY) + 8;
      w.ensure(80);
      const nY = w.party('NOTIFY PARTY', data.parties.notify, LEFT, MIDX - LEFT - 12, w.y);
      const kY = bankBlock(w, data.bank, MIDX, RW, w.y);
      w.y = Math.max(nY, kY) + 8;
      w.ensure(90);
      const sh = w.heading('SHIPPING DETAILS', LEFT, RIGHT - LEFT);
      const l = w.kv(
        [
          ['Country of origin', d.originCountryIdLabel],
          ['Port of loading', d.portOfLoadingIdLabel],
          ['Port of discharge', d.portOfDischargeIdLabel],
          ['Destination country', d.destinationCountryIdLabel],
        ],
        LEFT,
        MIDX - LEFT - 12,
        sh,
        104,
      );
      const stc = saidToContain(d);
      const r = w.kv(
        [
          ['Pre-carriage by', d.preCarriageBy],
          ...(vessel
            ? ([
                ['Place of receipt', d.placeOfReceipt],
                ['Vessel / voyage', [d.vesselFlightName, d.voyageNumber].filter(Boolean).join(' / ')],
              ] as [string, unknown][])
            : []),
          ['Terms of delivery', d.termsOf || d.incoterm],
          ['Payment', d.paymentTerms || d.paymentTermIdLabel],
          ...(stc ? ([['Containers', stc]] as [string, unknown][]) : []),
        ],
        MIDX,
        RW,
        sh,
        104,
      );
      w.y = Math.max(l, r) + 8;
      goodsTable(w, data, descriptions, { qtyLabel: 'Net (MT)', showBags: true });
      const leftTop = w.y;
      const hsCodes = [...new Set((d.lines as Row[]).map((l) => str(l.hsCode).trim()).filter(Boolean))];
      if (hsCodes.length) {
        pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(`HS code: ${hsCodes.join(', ')}`, LEFT, w.y, { width: 280 });
        w.y = pdf.y + 2;
      }
      pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK).text(`Total net weight: ${round(str(d.totalQuantityMt), 3)} MT`, LEFT, w.y, { width: 280 });
      if (Number(d.totalGrossWtMt)) pdf.text(`Total gross weight: ${round(str(d.totalGrossWtMt), 3)} MT`, LEFT, pdf.y + 2, { width: 280 });
      pdf.text(`Total bags: ${d.totalBags ?? 0}`, LEFT, pdf.y + 2, { width: 280 });
      const leftBottom = pdf.y;
      w.y = leftTop;
      const incoterm = str(d.incoterm);
      totalsBlock(w, [
        [`FOB value (${cur})`, formatAmount(str(d.fobAmount))],
        ...(charges && (incoterm === 'CFR' || incoterm === 'CIF') ? ([['Ocean freight', formatAmount(str(d.oceanFreightAmount))]] as [string, string][]) : []),
        ...(charges && incoterm === 'CIF' ? ([['Insurance', formatAmount(str(d.insuranceAmount))]] as [string, string][]) : []),
        ...(Number(d.discountAmount) ? ([['Discount', `- ${formatAmount(str(d.discountAmount))}`]] as [string, string][]) : []),
        [`Total ${incoterm} value (${cur})`, formatAmount(str(d.invoiceTotal)), true],
      ]);
      w.y = Math.max(w.y, leftBottom) + 4;
      words(w, d.amountInWords);
      w.ensure(110);
      const refTop = w.y;
      const refs = vessel
        ? [
            d.blNumber ? `Bill of lading no.: ${d.blNumber}   Date: ${formatDate(d.blDate) || '-'}` : '',
            d.shippingBillNumber ? `Shipping bill no.: ${d.shippingBillNumber}   Date: ${formatDate(d.shippingBillDate) || '-'}` : '',
            d.fcl ? `Containers: ${d.fcl}` : '',
          ].filter(Boolean)
        : [];
      pdf.font('Helvetica').fontSize(8).fillColor(DARK).text(refs.join('\n'), LEFT, refTop, { width: 260 });
      const leftEnd = pdf.y;
      w.y = d.showSignature ? Math.max(w.signature(MIDX, RW, refTop), leftEnd) + 8 : leftEnd + 8;
      w.terms(d.terms);
      if (stage !== 'FINAL') w.watermark('DRAFT');
    },
    data,
    'COMMERCIAL INVOICE',
  );
}

function packingList(data: PrintData) {
  const d = data.doc;
  return render(
    (w) => {
      const { pdf } = w;
      const ey = w.exporter(LEFT, 250, w.y);
      const ry = w.kv(
        [
          ['Invoice no.', d.documentNumber],
          ['Date', formatDate(d.documentDate)],
          ['Port of loading', d.portOfLoadingIdLabel],
          ['Port of discharge', d.portOfDischargeIdLabel],
          ['Vessel / voyage', [d.vesselFlightName, d.voyageNumber].filter(Boolean).join(' / ')],
          ['B/L no.', d.blNumber],
        ],
        MIDX,
        RIGHT - MIDX,
        w.heading('SHIPMENT', MIDX, RIGHT - MIDX),
        90,
      );
      w.y = Math.max(ey, ry) + 8;
      const cY = w.party('CONSIGNEE', data.parties.consignee ?? data.parties.buyer, LEFT, 250, w.y);
      const nY = w.party('NOTIFY PARTY', data.parties.notify, MIDX, RIGHT - MIDX, w.y);
      w.y = Math.max(cY, nY) + 10;

      const goods = d.lines.map((l) => `${l.productIdLabel}${l.packingText ? ` — ${l.packingText}` : ''}`).join('\n');
      if (goods) {
        w.y = w.heading('GOODS', LEFT, RIGHT - LEFT);
        pdf.font('Helvetica').fontSize(8.3).fillColor(DARK).text(goods, LEFT, w.y, { width: RIGHT - LEFT });
        w.y = pdf.y + 10;
      }

      const widths = [110, 100, 50, 60, 100, 103];
      const xs = widths.reduce<number[]>((acc, _w, i) => [...acc, i ? acc[i - 1] + widths[i - 1] : LEFT], []);
      const labels = CONTAINER_FIELDS.map((f) => f.label);
      const head = () => {
        pdf.font('Helvetica-Bold').fontSize(8).fillColor(GRAY);
        labels.forEach((t, i) => pdf.text(t, xs[i], w.y, { width: widths[i] - 4, align: i >= 3 ? 'right' : 'left' }));
        w.y = pdf.y + 3;
        w.rule('#777777');
        w.y += 4;
      };
      w.ensure(40);
      head();
      let bags = 0;
      const net: string[] = [];
      const gross: string[] = [];
      for (const c of d.containers) {
        if (w.y + 14 > BOTTOM) {
          pdf.addPage();
          w.header(true);
          head();
        }
        bags += Number(c.totalBags) || 0;
        net.push(str(c.netWeightKg));
        gross.push(str(c.grossWeightKg));
        const cells = [str(c.containerNumber), str(c.sealNumber), str(c.containerSize), String(c.totalBags), formatAmount(str(c.netWeightKg), 3), formatAmount(str(c.grossWeightKg), 3)];
        pdf.font('Helvetica').fontSize(8.3).fillColor(DARK);
        cells.forEach((t, i) => pdf.text(t, xs[i], w.y, { width: widths[i] - 4, align: i >= 3 ? 'right' : 'left' }));
        w.y += 14;
      }
      w.rule('#222222');
      w.y += 5;
      const sum = (values: string[]) => formatAmount(add(values, 3), 3);
      pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK);
      pdf.text(`TOTAL (${d.containers.length} container${d.containers.length === 1 ? '' : 's'})`, xs[0], w.y, { width: widths[0] + widths[1] + widths[2] });
      pdf.text(String(bags), xs[3], w.y, { width: widths[3] - 4, align: 'right' });
      pdf.text(sum(net), xs[4], w.y, { width: widths[4] - 4, align: 'right' });
      pdf.text(sum(gross), xs[5], w.y, { width: widths[5] - 4, align: 'right' });
      w.y += 30;
      if (d.showSignature) {
        w.ensure(100);
        w.y = w.signature(MIDX, RIGHT - MIDX, w.y) + 6;
      }
    },
    data,
    'PACKING LIST',
  );
}

export async function documentPdf(tx: Tx, ctx: RequestContext, key: string, id: string, kind: 'document' | 'packing-list') {
  const data = await loadPrintData(tx, ctx, key, id);
  const descriptions = await productTexts(tx, data.doc.lines);
  const safe = str(data.doc.documentNumber).replace(/[^A-Za-z0-9-]+/g, '_');
  if (kind === 'packing-list') {
    return { filename: `Packing_List_${safe}.pdf`, body: await packingList(data) };
  }
  if (data.def.key === 'oceanBills') {
    return { filename: `OBL_${safe}.pdf`, body: await oceanBill(data) };
  }
  if (data.def.key === 'certificates') {
    const d = data.doc;
    const [tpl] = (await tx.select().from(masterTables.certificateTemplates).where(eq(masterTables.certificateTemplates.id, d.certificateTemplateId as string))) as Row[];
    const obl = typeof d.oceanBillId === 'string' ? await getDocument(tx, ctx, 'oceanBills', d.oceanBillId, 'print').catch(() => null) : null;
    const ci = typeof d.commercialInvoiceId === 'string' ? await getDocument(tx, ctx, 'commercialInvoices', d.commercialInvoiceId, 'print').catch(() => null) : null;
    // Certificates print the chosen letterhead (not the company logo) and the chosen signature.
    const [lhRow] = (typeof d.letterheadId === 'string' ? await tx.select().from(masterTables.letterheads).where(eq(masterTables.letterheads.id, d.letterheadId)) : []) as Row[];
    const [sgRow] = (typeof d.signatureId === 'string' ? await tx.select().from(masterTables.signatures).where(eq(masterTables.signatures.id, d.signatureId)) : []) as Row[];
    const [lhImg, sgImg] = await Promise.all([image(tx, lhRow?.letterheadFileId), image(tx, sgRow?.signatureFileId)]);
    data.images = { ...data.images, logo: null, letterhead: lhImg ?? data.images.letterhead, signature: sgImg ?? data.images.signature };
    if (sgRow?.signatoryName) {
      data.company = { ...data.company, signatoryName: sgRow.signatoryName, signatoryDesignation: sgRow.signatoryDesignation ?? data.company.signatoryDesignation };
    }
    const title = str(tpl?.title) || str(d.certificateTemplateIdLabel) || 'CERTIFICATE';
    return { filename: `${title.replace(/[^A-Za-z0-9-]+/g, '_')}_${safe}.pdf`, body: await certificate(data, tpl ?? null, certContext(data, obl as Row | null, ci as Row | null)) };
  }
  const body = data.def.key === 'proformaInvoices' ? await proforma(data, descriptions) : data.def.key === 'productionOrders' ? await productionOrder(data, descriptions) : await commercialInvoice(data, descriptions);
  return { filename: `${data.def.short.replace(/\s+/g, '_')}_${safe}.pdf`, body };
}

// ------------------------------------------------------------------ ocean bill of lading (shipment details sheet)
function oceanBill(data: PrintData): Promise<Buffer> {
  const d = data.doc;
  const RW = RIGHT - MIDX;
  return render(
    (w) => {
      const ey = w.exporter(LEFT, MIDX - LEFT - 12, w.y);
      const ry = w.kv(
        [
          ['OBL reference', d.documentNumber],
          ['Date', formatDate(d.documentDate)],
          ['B/L no.', d.blNumber],
          ['B/L date', formatDate(d.blDate)],
          ['Shipping bill', [d.shippingBillNumber, formatDate(d.shippingBillDate)].filter(Boolean).join(' / ')],
        ],
        MIDX,
        RW,
        w.heading('BILL OF LADING', MIDX, RW),
        92,
      );
      w.y = Math.max(ey, ry) + 8;
      const cY = w.party('CONSIGNEE', data.parties.consignee ?? data.parties.buyer, LEFT, MIDX - LEFT - 12, w.y);
      const nY = w.party('NOTIFY PARTY', data.parties.notify ?? data.parties.buyer, MIDX, RW, w.y);
      w.y = Math.max(cY, nY) + 8;
      const sh = w.heading('VESSEL & ROUTE', LEFT, RIGHT - LEFT);
      const l = w.kv(
        [
          ['Vessel / flight', d.vesselName],
          ['Voyage no.', d.voyageNo],
          ['Shipping line', d.shippingLineIdLabel],
          ['Port of loading', d.portOfLoadingIdLabel],
          ['Port of discharge', d.portOfDischargeIdLabel],
        ],
        LEFT,
        MIDX - LEFT - 12,
        sh,
        110,
      );
      const r = w.kv(
        [
          ['Place of receipt', d.placeOfReceipt],
          ['Place of delivery', d.placeOfDelivery],
          ['Final destination', d.finalDestination],
          ['Agent at destination', d.destinationAgentIdLabel],
          ['LC no. & date', [d.lcNumber, formatDate(d.lcDate)].filter(Boolean).join(' / ')],
        ],
        MIDX,
        RW,
        sh,
        110,
      );
      w.y = Math.max(l, r) + 10;
      const mt = (v: unknown) => (v === null || v === undefined || v === '' ? '' : `${round(str(v), 3)} MT`);
      const sh2 = w.heading('CARGO', LEFT, RIGHT - LEFT);
      w.y =
        w.kv(
          [
            ['Description', d.goodsDescription],
            ['Packing', d.packing],
            ['Brand', d.brand],
            ['Net weight', mt(d.netWeightMt)],
            ['Gross weight', mt(d.grossWeightMt)],
            ['Total bags', d.totalBags],
            ['No. of containers', d.noOfContainers],
            ['Shipping marks', d.shippingMarks],
          ],
          LEFT,
          RIGHT - LEFT,
          sh2,
          110,
        ) + 12;
      w.y = w.signature(RIGHT - 210, 210, Math.max(w.y, BOTTOM - 110) + 6);
    },
    data,
    'OCEAN BILL OF LADING',
  );
}

// ------------------------------------------------------------------ certificates (template-driven letters)
/** Placeholder values for a certificate, from the invoice + OBL (labels already resolved by getDocument). */
function certContext(data: PrintData, obl: Row | null, ci: Row | null): Record<string, string> {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : round(String(v), 3));
  return {
    exporter: str(data.company.legalName) || str(data.company.name),
    consignee: data.parties.consignee?.name ?? data.parties.buyer?.name ?? '',
    applicant: data.parties.buyer?.name ?? data.parties.consignee?.name ?? '',
    buyer: data.parties.buyer?.name ?? '',
    notify: data.parties.notify?.name ?? '',
    invoice_no: str(ci?.documentNumber),
    invoice_date: formatDate(ci?.documentDate),
    bl_no: str(obl?.blNumber),
    bl_date: formatDate(obl?.blDate),
    shipping_bill_no: str(obl?.shippingBillNumber),
    shipping_bill_date: formatDate(obl?.shippingBillDate),
    vessel: str(obl?.vesselName),
    voyage: str(obl?.voyageNo),
    shipping_line: str(obl?.shippingLineIdLabel),
    port_loading: str(obl?.portOfLoadingIdLabel ?? ci?.portOfLoadingIdLabel),
    port_discharge: str(obl?.portOfDischargeIdLabel ?? ci?.portOfDischargeIdLabel),
    place_receipt: str(obl?.placeOfReceipt),
    place_delivery: str(obl?.placeOfDelivery),
    final_destination: str(obl?.finalDestination),
    destination_agent: str(obl?.destinationAgentIdLabel),
    destination_agent_address: str(obl?.destinationAgentAddress),
    net_weight: num(obl?.netWeightMt ?? ci?.totalQuantityMt),
    gross_weight: num(obl?.grossWeightMt ?? ci?.totalGrossWtMt),
    total_bags: str(obl?.totalBags ?? ci?.totalBags),
    no_of_containers: str(obl?.noOfContainers ?? ci?.noOfContainers),
    lc_no: str(obl?.lcNumber ?? ci?.lcNumber),
    lc_date: formatDate(obl?.lcDate ?? ci?.lcDate),
    lc_applicant_emails: str(obl?.lcApplicantEmails),
    po_no: str(ci?.buyerPoRef),
    po_date: formatDate(ci?.poDate),
    brand: str(obl?.brand ?? ci?.brand),
    description: str(obl?.goodsDescription),
    packing: str(obl?.packing),
    shipping_marks: str(obl?.shippingMarks),
    crop_year: str(obl?.cropYear),
    year_of_production: str(obl?.yearOfProduction),
    invoice_value: str(obl?.invoiceValue),
  };
}

function certificate(data: PrintData, tpl: Row | null, ctx: Record<string, string>): Promise<Buffer> {
  const d = data.doc;
  const title = str(tpl?.title) || str(d.certificateTemplateIdLabel) || 'CERTIFICATE';
  const body = fillTemplate(str(tpl?.body), ctx);
  const showTable = tpl ? tpl.showShipmentTable !== false : true;
  const RW = RIGHT - MIDX;
  return render(
    (w) => {
      const { pdf } = w;
      const ey = w.exporter(LEFT, MIDX - LEFT - 12, w.y, 'EXPORTER / BENEFICIARY');
      const ry = w.kv(
        [
          ['Certificate no.', d.documentNumber],
          ['Date', formatDate(d.documentDate)],
          ['Invoice no.', ctx.invoice_no],
          ['LC no.', ctx.lc_no],
          ['B/L no.', ctx.bl_no],
        ],
        MIDX,
        RW,
        w.heading('REFERENCE', MIDX, RW),
        90,
      );
      w.y = Math.max(ey, ry) + 8;
      w.y = w.party('TO — CONSIGNEE / APPLICANT', data.parties.consignee ?? data.parties.buyer, LEFT, RIGHT - LEFT, w.y) + 10;
      if (showTable) {
        const mt = (v: string) => (v ? `${v} MT` : '');
        const sh = w.heading('SHIPMENT DETAILS', LEFT, RIGHT - LEFT);
        const l = w.kv(
          [
            ['Vessel', ctx.vessel],
            ['Port of loading', ctx.port_loading],
            ['Port of discharge', ctx.port_discharge],
            ['Place of delivery', ctx.place_delivery],
            ['Shipping line', ctx.shipping_line],
            ['Agent at destination', ctx.destination_agent],
          ],
          LEFT,
          MIDX - LEFT - 12,
          sh,
          110,
        );
        const r = w.kv(
          [
            ['Description', ctx.description || ctx.brand],
            ['Packing', ctx.packing],
            ['Net weight', mt(ctx.net_weight)],
            ['Gross weight', mt(ctx.gross_weight)],
            ['Total bags', ctx.total_bags],
            ['PO no.', ctx.po_no],
          ],
          MIDX,
          RW,
          sh,
          90,
        );
        w.y = Math.max(l, r) + 12;
      }
      w.ensure(80);
      pdf.font('Helvetica').fontSize(10).fillColor(DARK).text(body, LEFT, w.y, { width: RIGHT - LEFT, lineGap: 3, align: 'left' });
      w.y = pdf.y + 10;
      if (str(d.remark).trim()) {
        pdf.font('Helvetica').fontSize(9).fillColor(GRAY).text(str(d.remark), LEFT, w.y, { width: RIGHT - LEFT });
        w.y = pdf.y + 10;
      }
      w.y = w.signature(RIGHT - 210, 210, Math.max(w.y, BOTTOM - 110) + 10);
    },
    data,
    title.toUpperCase(),
  );
}
