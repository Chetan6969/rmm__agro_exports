/**
 * Document intake: recognise an export document from its text (any format — the server reads PDFs,
 * scans via offline OCR, Excel, Word) and pull out the fields the ERP needs. Pure functions, shared by
 * the API (authoritative) and the web app (labels, review screen).
 *
 * Nothing here is final: every value is a suggestion with the text it came from (evidence); a person
 * checks it on the review screen and confirms. Corrections teach per-layout templates (see learn/apply).
 */

// ------------------------------------------------------------------ kinds

export type IntakeFieldType = 'text' | 'date' | 'number' | 'money' | 'currency';

export interface IntakeFieldDef {
  key: string;
  label: string;
  type: IntakeFieldType;
}

export interface IntakeKind {
  key: string;
  label: string;
  /** What confirming it does in the ERP. */
  action: 'order' | 'order-lc' | 'lot' | 'lot-doc' | 'order-doc' | 'none';
  /** Words that point to this kind (title words weigh most). */
  title: RegExp[];
  words: RegExp[];
  /** File name hints (folder habits: "BL 75.pdf", "Shipping bill 75.pdf"). */
  file?: RegExp;
  fields: IntakeFieldDef[];
}

const f = (key: string, label: string, type: IntakeFieldType = 'text'): IntakeFieldDef => ({ key, label, type });

const REFS = [f('invoiceNumber', 'Our export invoice no.'), f('buyerPoRef', "Buyer's PO / contract no."), f('batchNo', 'Batch / lot no.')];

export const INTAKE_KINDS: IntakeKind[] = [
  {
    key: 'buyer_po',
    label: 'Buyer PO / contract',
    action: 'order',
    // "Contract no" alone is not enough: our own shipment papers quote the buyer's contract number too
    title: [/purchase\s+order/i, /sales\s+contract/i, /order\s+confirmation/i, /^\s*contract\b/im],
    words: [/supplier/i, /delivery\s+(schedule|date|terms)/i, /unit\s+(rate|price)/i, /\bitem\b/i, /quantity/i, /\bbuyer\b/i, /\bseller\b/i, /shipment\s+period/i],
    file: /(contract|\bct\b|ct\.|purchase order|\bpo\b|^\d{8,10}\.pdf$)/i,
    fields: [
      f('buyerPoRef', "Buyer's PO / contract no."),
      f('poDate', 'PO date', 'date'),
      f('buyerName', 'Buyer'),
      f('currency', 'Currency', 'currency'),
      f('incoterm', 'Incoterm'),
      f('paymentTerms', 'Payment terms'),
      f('portOfLoading', 'Port of loading'),
      f('portOfDischarge', 'Port of discharge'),
      f('deliveryDate', 'Delivery / shipment by', 'date'),
      f('cropYear', 'Crop year'),
      f('brand', 'Brand'),
      f('totalQuantityMt', 'Total quantity (MT)', 'number'),
      f('totalAmount', 'Total amount', 'money'),
    ],
  },
  {
    key: 'proforma',
    label: 'Proforma invoice',
    action: 'order',
    title: [/proforma\s+invoice/i, /\bP\.?\s?I\.?\s+(no|number)/i],
    words: [/buyer/i, /consignee/i, /rate/i, /amount/i],
    file: /(proforma|\bpi\b)/i,
    fields: [f('piNumber', 'PI no.'), f('poDate', 'PI date', 'date'), f('buyerName', 'Buyer'), f('currency', 'Currency', 'currency'), f('incoterm', 'Incoterm'), f('paymentTerms', 'Payment terms'), f('totalQuantityMt', 'Total quantity (MT)', 'number'), f('totalAmount', 'Total amount', 'money')],
  },
  {
    key: 'lc',
    label: 'Letter of credit',
    action: 'order-lc',
    title: [/letter\s+of\s+credit/i, /documentary\s+credit/i, /\bMT\s?700\b/i, /\bLC\s+(no|number)/i],
    words: [/issuing\s+bank/i, /beneficiary/i, /applicant/i, /expiry/i, /latest\s+(date\s+of\s+)?shipment/i, /:\s?20\s?:/],
    file: /\b(lc|letter of credit)\b/i,
    fields: [f('lcNumber', 'LC no.'), f('lcDate', 'LC date', 'date'), f('expiryDate', 'Expiry date', 'date'), f('latestShipment', 'Latest shipment', 'date'), f('amount', 'LC amount', 'money'), f('currency', 'Currency', 'currency'), f('issuingBank', 'Issuing bank'), f('buyerPoRef', "Buyer's PO / contract no.")],
  },
  {
    key: 'booking',
    label: 'Booking confirmation',
    action: 'lot',
    title: [/booking\s+confirmation/i, /booking\s+(no|number|ref)/i],
    words: [/vessel/i, /voyage/i, /cut[- ]?off/i, /\bETD\b/i, /\bETA\b/i, /equipment/i, /container/i],
    file: /booking/i,
    fields: [f('bookingNo', 'Booking no.'), f('shippingLine', 'Shipping line'), f('vessel', 'Vessel / voyage'), f('etd', 'ETD', 'date'), f('eta', 'ETA', 'date'), f('containerCount', 'Containers', 'number'), f('portOfLoading', 'Port of loading'), f('portOfDischarge', 'Port of discharge'), ...REFS],
  },
  {
    key: 'bill_of_lading',
    label: 'Bill of lading',
    action: 'lot',
    title: [/bill\s+of\s+lading/i, /\bB\/L\s+(no|number)/i, /sea\s+waybill/i],
    words: [/shipper/i, /consignee/i, /notify/i, /vessel/i, /port\s+of\s+(loading|discharge)/i, /said\s+to\s+contain/i, /freight/i],
    file: /(\bbl\b|bill of lading|\bobl\b|draft bl)/i,
    fields: [f('blNumber', 'B/L no.'), f('blDate', 'B/L date', 'date'), f('vessel', 'Vessel / voyage'), f('shippingLine', 'Shipping line'), f('containerCount', 'Containers', 'number'), f('containers', 'Container nos.'), f('portOfLoading', 'Port of loading'), f('portOfDischarge', 'Port of discharge'), f('grossWeightKg', 'Gross weight (kg)', 'number'), f('isDraft', 'Draft (not original)'), ...REFS],
  },
  {
    key: 'shipping_bill',
    label: 'Shipping bill',
    action: 'lot',
    title: [/shipping\s+bill/i, /let\s+export\s+(copy|order)/i],
    words: [/icegate/i, /\bLEO\b/i, /port\s+code/i, /\bSB\s+(no|date)/i, /customs/i, /\bIEC\b/i],
    file: /(shipping bill|shiping bill|\bsb\b)/i,
    fields: [f('sbNumber', 'Shipping bill no.'), f('sbDate', 'Shipping bill date', 'date'), f('leoDate', 'LEO date', 'date'), f('portCode', 'Port code'), f('fobValue', 'FOB value (₹)', 'money'), f('invoiceNumber', 'Our export invoice no.')],
  },
  {
    key: 'export_invoice',
    label: 'Export invoice',
    action: 'lot',
    title: [/export\s+invoice/i, /commercial\s+invoice/i, /invoice\s+cum\s+packing/i, /custom\s+invoice/i],
    words: [/exporter/i, /consignee/i, /port\s+of\s+(loading|discharge)/i, /terms\s+of\s+delivery/i, /net\s+weight/i, /\bIEC\b/i],
    file: /(export invoice|commercial invoice|custom invoice|invoice[-_ ]rmm)/i,
    fields: [f('invoiceNumber', 'Export invoice no.'), f('invoiceDate', 'Invoice date', 'date'), f('buyerPoRef', "Buyer's PO / contract no."), f('lcNumber', 'LC no.'), f('quantityMt', 'Quantity (MT)', 'number'), f('amount', 'Invoice amount', 'money'), f('currency', 'Currency', 'currency'), f('containerCount', 'Containers', 'number'), f('batchNo', 'Batch no.')],
  },
  {
    key: 'packing_list',
    label: 'Packing list',
    action: 'lot-doc',
    title: [/packing\s+list/i, /weight\s+list/i],
    words: [/gross/i, /net/i, /bags/i, /container/i],
    file: /packing/i,
    fields: [...REFS, f('containerCount', 'Containers', 'number'), f('bags', 'Bags', 'number')],
  },
  {
    key: 'certificate_of_origin',
    label: 'Certificate of origin',
    action: 'lot-doc',
    title: [/certificate\s+of\s+origin/i, /\bE[- ]?COO\b/i],
    words: [/chamber/i, /exporter/i, /origin/i, /country/i],
    file: /(\bcoo\b|origin)/i,
    fields: [f('certificateNo', 'Certificate no.'), f('certificateDate', 'Date', 'date'), ...REFS],
  },
  {
    key: 'phytosanitary',
    label: 'Phytosanitary certificate',
    action: 'lot-doc',
    title: [/phytosanitary/i, /plant\s+protection/i],
    words: [/plant\s+quarantine/i, /treatment/i, /disinfestation/i],
    file: /phyto/i,
    fields: [f('certificateNo', 'Certificate no.'), f('certificateDate', 'Date', 'date'), ...REFS],
  },
  {
    key: 'fumigation',
    label: 'Fumigation certificate',
    action: 'lot-doc',
    title: [/fumigation/i],
    words: [/aluminium\s+phosphide|phosphine|methyl\s+bromide|\bALP\b|\bMBR\b/i, /dosage/i, /exposure/i],
    file: /fumigation/i,
    fields: [f('certificateNo', 'Certificate no.'), f('certificateDate', 'Date', 'date'), f('containers', 'Container nos.'), ...REFS],
  },
  {
    key: 'health_certificate',
    label: 'Health certificate',
    action: 'lot-doc',
    title: [/health\s+certificate/i],
    words: [/fit\s+for\s+human\s+consumption/i, /export\s+inspection/i],
    file: /(\bhc\b|health)/i,
    fields: [f('certificateNo', 'Certificate no.'), f('certificateDate', 'Date', 'date'), ...REFS],
  },
  {
    key: 'test_report',
    label: 'Test / analysis report',
    action: 'lot-doc',
    title: [/test\s+report/i, /certificate\s+of\s+analysis/i, /analysis\s+report/i, /\bCOA\b/],
    words: [/mycotoxin|aflatoxin|pesticide|residue|DNA|moisture|broken|sample/i, /laboratory/i, /result/i],
    file: /(test|report|analysis|mycotoxin|pesticide|dna|\bcoa\b)/i,
    fields: [f('reportNo', 'Report no.'), f('reportDate', 'Date', 'date'), ...REFS],
  },
  {
    key: 'certificate_of_conformity',
    label: 'Certificate of conformity (COC)',
    action: 'lot-doc',
    title: [/certificate\s+of\s+conformity/i, /\bCOC\b/, /\bSABER\b|\bSASO\b|conformity\s+assessment/i],
    words: [/inspection/i, /conform/i, /shipment/i],
    file: /\bcoc\b/i,
    fields: [f('certificateNo', 'Certificate no.'), f('certificateDate', 'Date', 'date'), ...REFS],
  },
  {
    key: 'apeda',
    label: 'APEDA / COI registration',
    action: 'lot-doc',
    title: [/APEDA/i, /certificate\s+of\s+inspection/i, /\bRCAC\b/i],
    words: [/basmati/i, /registration/i],
    file: /(apeda|\bcoi\b)/i,
    fields: [f('certificateNo', 'Certificate no.'), f('certificateDate', 'Date', 'date'), ...REFS],
  },
  {
    key: 'bill_of_exchange',
    label: 'Bill of exchange',
    action: 'lot-doc',
    title: [/bill\s+of\s+exchange/i, /exchange\s+for/i],
    words: [/drawee/i, /at\s+sight/i, /drawn\s+under/i],
    file: /(bill of exchange|\bboe\b)/i,
    fields: [f('amount', 'Amount', 'money'), f('lcNumber', 'LC no.'), ...REFS],
  },
  {
    key: 'eia_intimation',
    label: 'EIA intimation / inspection',
    action: 'lot-doc',
    title: [/intimation/i, /export\s+inspection\s+agency/i],
    words: [/inspection/i, /\bEIA\b/i, /lot/i],
    file: /(intimation|\beia\b)/i,
    fields: [...REFS],
  },
  {
    key: 'traceability',
    label: 'Traceability record',
    action: 'lot-doc',
    title: [/traceability/i, /mass\s+balance/i],
    words: [/paddy/i, /mandi/i, /gate\s+entry/i],
    file: /(traceability|mass balance|production data|ipqc)/i,
    fields: [...REFS],
  },
  {
    key: 'vendor_po',
    label: 'Our purchase order (packaging / vendor)',
    action: 'order-doc',
    title: [/purchase\s+order/i],
    words: [/supplier\s+\(bill\s+from\)/i, /voucher\s+no/i, /strips|bags|seal|tags|liner/i, /invoice\s+to/i],
    file: /(vendor po|purchase order_)/i,
    fields: [f('vendorPoNo', 'PO no.'), f('vendorName', 'Supplier'), f('poDate', 'Date', 'date'), f('totalAmount', 'Amount', 'money')],
  },
  {
    key: 'other',
    label: 'Other document',
    action: 'none',
    title: [],
    words: [],
    fields: [...REFS],
  },
];

export const INTAKE_KIND_MAP: Record<string, IntakeKind> = Object.fromEntries(INTAKE_KINDS.map((k) => [k.key, k]));
export const intakeKind = (key: string | null | undefined) => INTAKE_KIND_MAP[key ?? ''] ?? INTAKE_KIND_MAP.other;

// ------------------------------------------------------------------ classification

export interface Classification {
  kind: string;
  confidence: number;
  scores: { kind: string; score: number }[];
}

/** Score every kind by its title words (first part of the text), body words and the file name. */
export function classify(text: string, fileName = ''): Classification {
  const head = (text ?? '').slice(0, 1500);
  const body = (text ?? '').slice(0, 20000);
  const name = fileName.split(/[\\/]/).pop() ?? '';
  const scores = INTAKE_KINDS.filter((k) => k.key !== 'other').map((k) => {
    let score = 0;
    for (const rx of k.title) if (rx.test(head)) score += 6;
      else if (rx.test(body)) score += 2;
    for (const rx of k.words) if (rx.test(body)) score += 1;
    // the office names files by what they are ("Packing list 75.pdf", "COC 75.pdf"): a strong hint
    if (k.file?.test(name)) score += 9;
    return { kind: k.key, score };
  });
  // our own purchase orders (packaging) carry "Invoice To RMM…" and "Supplier (Bill from)"
  const vp = scores.find((s) => s.kind === 'vendor_po')!;
  const po = scores.find((s) => s.kind === 'buyer_po')!;
  if (/supplier\s*\(bill\s*from\)/i.test(body)) {
    vp.score += 8;
    po.score -= 4;
  }
  // a document that already carries our export invoice number is a shipment document, never the buyer's PO
  OWN_INVOICE_RX.lastIndex = 0;
  if (OWN_INVOICE_RX.test(body)) {
    po.score -= 10;
    scores.find((s) => s.kind === 'proforma')!.score -= 6;
  }
  OWN_INVOICE_RX.lastIndex = 0;
  scores.sort((a, b) => b.score - a.score);
  const [top, next] = scores;
  if (!top || top.score < 4) return { kind: 'other', confidence: 0, scores };
  const confidence = Math.max(0.2, Math.min(0.99, (top.score - (next?.score ?? 0) + 2) / (top.score + 2)));
  return { kind: top.kind, confidence: Math.round(confidence * 100) / 100, scores };
}

// ------------------------------------------------------------------ value helpers

export interface Extracted {
  value: string;
  /** 0–1: how sure the rule is. Learned templates give 0.9, exact own-format rules 0.95. */
  confidence: number;
  /** The text the value came from (shown on the review screen). */
  evidence: string;
  source: 'rule' | 'template' | 'user';
}

export interface ExtractedLine {
  description: string;
  buyerItemCode: string | null;
  packKg: number | null;
  port: string | null;
  quantityMt: string | null;
  rate: string | null;
  amount: string | null;
  dispatchBy: string | null;
}

export interface ExtractionResult {
  fields: Record<string, Extracted>;
  lines: ExtractedLine[];
  /** Our references found anywhere in the text (used to match the document to an order or lot). */
  refs: { invoiceNumbers: string[]; poNumbers: string[]; blNumbers: string[]; containers: string[]; lcNumbers: string[] };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const isoOk = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null);
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Dates as written on export documents: 12/09/2026, 12-09-26, 29-SEP-26, 18.11.2026, Sep 29 2026, 2026-09-29. Day first. */
export function parseDocDate(s: string | null | undefined): string | null {
  if (!s) return null;
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return isoOk(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return isoOk(year(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  m = /([A-Za-z]{3,9})[ .-]+(\d{1,2})(?:st|nd|rd|th)?,?[ .-]+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return isoOk(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return isoOk(year(m[3]), Number(m[2]), Number(m[1]));
  // Excel serial dates (export invoices kept in .xls)
  m = /^\s*(4\d{4})(?:\.0+)?\s*$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(m[1]) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** 1,234,567.00 / 12,34,567 / 1.234.567,00 / 123456 → plain decimal text. */
export function parseAmount(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /-?\d[\d,.' ]*\d|\d/.exec(s.replace(/\s(?=\d{3}\b)/g, ''));
  if (!m) return null;
  let t = m[0].replace(/[' ]/g, '');
  if (/,\d{2}$/.test(t) && /\.\d{3}/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  // 46.080 → 46.08, 525.000 → 525
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
}

const CURRENCIES: [RegExp, string][] = [
  [/\bUSD\b|US\s?\$|U\.S\.\s?dollar|\$/i, 'USD'],
  [/\bEUR\b|€|euro/i, 'EUR'],
  [/\bGBP\b|£/i, 'GBP'],
  [/\bAED\b|dirham/i, 'AED'],
  [/\bSAR\b|riyal/i, 'SAR'],
  [/\bINR\b|₹|rupee/i, 'INR'],
];
export function findCurrency(s: string): string | null {
  return CURRENCIES.find(([rx]) => rx.test(s))?.[1] ?? null;
}

/** OCR reads 0 as O at the end of codes (ABCLINMUNOO1234 → ABCLINMUN001234, 1 as I/l between digits). */
export function fixCode(code: string): string {
  const m = /^(.*?[A-NP-Z])([O0-9]+)$/.exec(code);
  const fixed = m && /\d/.test(m[2]) ? m[1] + m[2].replace(/O/g, '0') : code;
  return fixed.replace(/(?<=\d)[Il](?=\d)/g, '1');
}

const lines = (text: string) =>
  (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** Words that sit where a value should be but are not one ("see Clause 8", "AGENT:", "ORIGINAL"). */
const NOT_A_VALUE = /^(\(?see\b|clause|agent|original|copy|no\.?$|number$|date$|and\b|of\b|the\b|page\b|n\/a$)/i;

/** References (PO, BL, certificate numbers…) always contain a digit. */
export const REF_RX = /(?=[A-Z/-]*\d)[A-Z0-9][A-Z0-9/\-.]{2,40}/i;

/**
 * The value written after a label on the same line ("PO No 9000001234", "BL No.: ABC") or on the
 * next line. Lines matching `skip` are ignored (e.g. "Delivery Date" when looking for the PO date).
 */
export function valueAfter(text: string, label: RegExp, pattern: RegExp = REF_RX, skip?: RegExp): { value: string; evidence: string } | null {
  const ls = lines(text);
  const ok = (m: RegExpExecArray | null) => (m && !NOT_A_VALUE.test(m[0].trim()) ? m : null);
  for (let i = 0; i < ls.length; i++) {
    if (skip?.test(ls[i])) continue;
    const m = label.exec(ls[i]);
    if (!m) continue;
    const rest = ls[i].slice(m.index + m[0].length).replace(/^[\s:#.\-–=|]+/, '');
    const same = ok(pattern.exec(rest));
    if (same) return { value: same[0].trim(), evidence: ls[i] };
    const next = ls[i + 1] && !skip?.test(ls[i + 1]) ? ok(pattern.exec(ls[i + 1])) : null;
    if (next) return { value: next[0].trim(), evidence: `${ls[i]} / ${ls[i + 1]}` };
  }
  return null;
}

const DATE_RX = /\d{1,2}[-/. ](?:\d{1,2}|[A-Za-z]{3,9})[-/., ]+\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\b4\d{4}(?:\.0)?\b/;
const MONEY_RX = /\d[\d,.' ]*\d|\d/;
/**
 * A money total: comma-grouped (Indian or western, "1,23,456.00"), dot-grouped European, or 4–9 plain
 * digits. A quantity with three decimals ("120.500") and account numbers (10+ digits) do not count.
 */
const TOTAL_RX = /\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?![\d,])|\d{1,3}(?:\.\d{3}){2,}(?:,\d{2})?|\d{1,3}(?:\.\d{3})+,\d{2}|(?<![\d,.])\d{4,9}(?:\.\d{1,2})?(?![\d,.])/;
const DATE_SKIP = /\b(delivery|expiry|validity|valid\s+till|shipment|LUT|ARN|order\s+no|contract\s+no|L\.?C\.?\s+no|or\s+issue)\b/i;

function put(out: Record<string, Extracted>, key: string, hit: { value: string; evidence: string } | null, confidence: number, type: IntakeFieldType = 'text') {
  if (!hit || out[key]) return;
  let value: string | null = hit.value;
  if (type === 'date') value = parseDocDate(hit.value);
  else if (type === 'number' || type === 'money') value = parseAmount(hit.value);
  if (!value) return;
  out[key] = { value, confidence, evidence: hit.evidence.slice(0, 300), source: 'rule' };
}

// ------------------------------------------------------------------ references (matching)

export const OWN_INVOICE_RX = /\b([A-Z]{2,8})\s*\/\s*EX\s*\/\s*(\d{2}-\d{2})\s*\/\s*(\d{1,4})\b/g;
const CONTAINER_RX = /\b([A-Z]{3}[UJZ])\s?(\d{6})\s?-?\s?(\d)\b/g;

export function findRefs(text: string): ExtractionResult['refs'] {
  const t = text ?? '';
  const uniq = (a: string[]) => [...new Set(a)];
  const invoiceNumbers = uniq([...t.matchAll(OWN_INVOICE_RX)].map((m) => `${m[1]}/EX/${m[2]}/${m[3]}`));
  const containers = uniq([...t.matchAll(CONTAINER_RX)].map((m) => `${m[1]}${m[2]}${m[3]}`));
  const poNumbers = uniq(
    [...t.matchAll(/\b(?:P\.?\s?O\.?|purchase\s+order|contract|order|ct\.?)\s*(?:no\.?|number|#)?\s*[:.\-]?\s*([A-Z]{0,4}[-/]?\d{4,12}(?:[-/][A-Z0-9]{1,8})?)/gi)].map((m) => m[1]),
  );
  const blNumbers = uniq([...t.matchAll(/\b(?:B\/?L|bill\s+of\s+lading|booking)\s*(?:no\.?|number|ref\.?)?\s*[:.\-]?\s*([A-Z]{2,6}[A-Z0-9O]{6,14})\b/gi)].map((m) => fixCode(m[1].toUpperCase())));
  const lcNumbers = uniq([...t.matchAll(/\bL\.?\s?C\.?\s*(?:no\.?|number)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/-]{4,24})/g)].map((m) => m[1]).filter((x) => /\d{3}/.test(x)));
  return { invoiceNumbers, poNumbers, blNumbers, containers, lcNumbers };
}

// ------------------------------------------------------------------ line items (buyer POs, contracts)

/**
 * Item lines of a buyer PO. Handles the SAP style
 *   "10 9000000011 Rice 40 Kg FOB Mundra DC Riyadh 100.000 MT 1000.00 / 1 MT 100000.00"
 * and simpler "Basmati rice 1121 … 400 MT 850 USD PMT 340000" lines.
 */
export function extractLines(text: string): ExtractedLine[] {
  const out: ExtractedLine[] = [];
  const flat = (text ?? '').replace(/\s+/g, ' ');
  const sap = /\b(\d{1,4}0)\s+(\d{6,12})\s+(.{3,90}?)\s+([\d,]+(?:\.\d+)?)\s*(MT|M\.T\.|MTS|TONS?)\s+([\d,]+(?:\.\d+)?)\s*\/\s*1\s*(?:MT|M\.T\.|TON)\s+([\d,]+(?:\.\d+)?)/gi;
  for (const m of flat.matchAll(sap)) {
    const desc = m[3].trim();
    out.push({
      description: desc,
      buyerItemCode: m[2],
      packKg: packKg(desc),
      port: portIn(desc),
      quantityMt: parseAmount(m[4]),
      rate: parseAmount(m[6]),
      amount: parseAmount(m[7]),
      dispatchBy: null,
    });
  }
  if (out.length) return out;
  // generic: "<description> <qty> MT <rate> <amount>" on one line
  for (const l of lines(text)) {
    const m = /^(.{6,120}?)\s([\d,]+(?:\.\d+)?)\s*(?:MT|M\.T\.|MTS|metric\s+tons?)\b\D{0,25}?([\d,]+(?:\.\d+)?)(?:\s*(?:USD|EUR|US\$|\$)?\s*(?:\/\s*MT|PMT|per\s+MT))?\D{0,10}([\d,]{4,}(?:\.\d+)?)?/i.exec(l);
    if (!m) continue;
    const qty = parseAmount(m[2]);
    const rate = parseAmount(m[3]);
    if (!qty || !rate || Number(qty) <= 0 || Number(rate) < 50) continue;
    out.push({ description: m[1].trim(), buyerItemCode: null, packKg: packKg(m[1]), port: portIn(m[1]), quantityMt: qty, rate, amount: m[4] ? parseAmount(m[4]) : null, dispatchBy: null });
  }
  return out;
}

/** "Sunrise 40 Kg", "4X10KG", "8 x 5 kg", "1*40" → kilograms per bag (outer). */
export function packKg(s: string): number | null {
  const multi = /(\d{1,3})\s*[x×*]\s*(\d{1,3}(?:\.\d+)?)\s*kg/i.exec(s);
  if (multi) return Number(multi[1]) * Number(multi[2]);
  const one = /(\d{1,3}(?:\.\d+)?)\s*kgs?\b/i.exec(s);
  return one ? Number(one[1]) : null;
}

/** Inner packs per outer bag: "4X10KG" → 4, "40 kg" → 1. */
export function innerPacks(s: string): number {
  const m = /(\d{1,3})\s*[x×*]\s*\d{1,3}(?:\.\d+)?\s*kg/i.exec(s ?? '');
  return m ? Number(m[1]) : 1;
}

function portIn(s: string): string | null {
  const m = /\b(?:DC|port|to|POD)[\s:-]*([A-Z][A-Za-z]{2,20}(?:\s[A-Z][a-z]{2,15})?)\s*$/i.exec(s.trim());
  return m ? m[1].replace(/\s+-\s*/, ' ').trim() : null;
}

// ------------------------------------------------------------------ per-kind rules

type Rule = (text: string, out: Record<string, Extracted>) => void;

const common: Rule = (t, o) => {
  const refs = findRefs(t);
  if (refs.invoiceNumbers[0]) o.invoiceNumber ??= { value: refs.invoiceNumbers[0], confidence: 0.9, evidence: refs.invoiceNumbers[0], source: 'rule' };
  // "Contract no: 9000001235" written inline beats a label whose value sits cells away (a pin code there)
  if (refs.poNumbers[0]) o.buyerPoRef ??= { value: refs.poNumbers[0], confidence: 0.8, evidence: refs.poNumbers[0], source: 'rule' };
  put(o, 'buyerPoRef', valueAfter(t, /(buyer'?s?\s+order\s+no\.?(?:\/contract\s+no)?|purchase\s+order\s+no\.?|p\.?\s?o\.?\s+no\.?|contract\s+no\.?)/i, REF_RX), 0.75);
  put(o, 'batchNo', valueAfter(t, /\b(batch|lot)\s+(no\.?|number)/i, /(?=[A-Z/-]*\d)[A-Z0-9][A-Z0-9/-]{1,20}/i), 0.7);
  put(o, 'lcNumber', valueAfter(t, /\b(L\.?\s?C\.?\s+(no\.?|number)|documentary\s+credit\s+(no|number))/i, REF_RX), 0.75);
  const cur = findCurrency(t.slice(0, 8000));
  if (cur) o.currency ??= { value: cur, confidence: 0.6, evidence: cur, source: 'rule' };
};

const RULES: Record<string, Rule> = {
  buyer_po: (t, o) => {
    put(o, 'buyerPoRef', valueAfter(t, /\b(PO\s*(No|Number|#)|Purchase\s+Order\s+(No|Number)|Contract\s+(No|Number)|Ct\.?\s*No\.?)\b/i, REF_RX), 0.85);
    put(o, 'poDate', valueAfter(t, /\b(P\.?O\.?\s*Date|Order\s+Date|Contract\s+Date|Date\s+of\s+contract)\b/i, DATE_RX, /\bdelivery\b/i), 0.75, 'date');
    put(o, 'poDate', valueAfter(t, /\b(Dated?)\b/i, DATE_RX, DATE_SKIP), 0.5, 'date');
    put(o, 'deliveryDate', valueAfter(t, /\b(Delivery\s+Date|Shipment\s+(period|date)|Latest\s+shipment)\b/i, DATE_RX), 0.7, 'date');
    put(o, 'incoterm', valueAfter(t, /\b(Incoterms?|Terms\s+of\s+delivery|Delivery\s+terms)\b/i, /\b(FOB|CFR|CIF|CNF|C&F|EXW|FCA|DAP)\b/i), 0.75);
    if (!o.incoterm) {
      const m = /\b(FOB|CFR|CIF|C&F|CNF)\b/.exec(t);
      if (m) o.incoterm = { value: m[1] === 'C&F' || m[1] === 'CNF' ? 'CFR' : m[1], confidence: 0.55, evidence: m[0], source: 'rule' };
    }
    put(o, 'paymentTerms', valueAfter(t, /\b(Payment\s+terms?|Terms\s+of\s+payment|Payment)\b/i, /(LC\s+at\s+sight|CAD[^.\n]{0,40}|DP[^.\n]{0,30}|advance[^.\n]{0,40}|[A-Z][^\n]{4,60})/i), 0.55);
    if (!o.paymentTerms && /LC\s+at\s+Sight/i.test(t)) o.paymentTerms = { value: 'LC at sight', confidence: 0.7, evidence: 'LC at Sight', source: 'rule' };
    put(o, 'portOfLoading', valueAfter(t, /\b(Port\s+of\s+(Loading|Shipment)|POL|FOB)\b/i, /[A-Z][A-Za-z ]{2,30}/), 0.5);
    put(o, 'portOfDischarge', valueAfter(t, /\b(Port\s+of\s+(Discharge|Destination)|POD|Destination)\b/i, /[A-Z][A-Za-z ]{2,30}/), 0.5);
    put(o, 'cropYear', valueAfter(t, /\bCrop\s*(year)?\b/i, /\b20\d{2}(?:[-/]\d{2,4})?\b/), 0.7);
    put(o, 'brand', valueAfter(t, /\bBrand\b/i, /[A-Z][A-Za-z ]{2,30}/), 0.5);
    put(o, 'buyerName', valueAfter(t, /\b(Buyer|Purchaser|Bill\s+to|Messrs)\b/i, /[A-Z][A-Za-z0-9&.,' -]{3,60}/), 0.5);
    put(o, 'totalAmount', valueAfter(t, /\b(Total(\s+amount|\s+value|\s+in\s+words)?|Grand\s+total)\b/i, TOTAL_RX), 0.6, 'money');
  },
  proforma: (t, o) => {
    put(o, 'piNumber', valueAfter(t, /\b(PI\s*(No|Number)|Proforma\s+(Invoice\s+)?No|Voucher\s+No)\b/i, REF_RX), 0.8);
    RULES.buyer_po(t, o);
  },
  lc: (t, o) => {
    put(o, 'lcNumber', valueAfter(t, /(:?\s?20\s?:|documentary\s+credit\s+(no|number)|\bL\.?\s?C\.?\s+(no|number))/i, REF_RX), 0.85);
    put(o, 'lcDate', valueAfter(t, /(:?\s?31C\s?:|date\s+of\s+issue|issue\s+date|dated?)/i, DATE_RX), 0.7, 'date');
    put(o, 'expiryDate', valueAfter(t, /(:?\s?31D\s?:|expiry|expiration)/i, DATE_RX), 0.7, 'date');
    put(o, 'latestShipment', valueAfter(t, /(:?\s?44C\s?:|latest\s+(date\s+of\s+)?shipment)/i, DATE_RX), 0.7, 'date');
    put(o, 'amount', valueAfter(t, /(:?\s?32B\s?:|amount|currency\s+code,?\s+amount)/i, /(?:[A-Z]{3}\s?)?\d[\d,.]+/), 0.65, 'money');
    put(o, 'issuingBank', valueAfter(t, /(issuing\s+bank|:?\s?52A\s?:)/i, /[A-Z][A-Za-z ,.&()-]{3,60}/), 0.5);
  },
  booking: (t, o) => {
    put(o, 'bookingNo', valueAfter(t, /\b(booking\s+(no|number|ref(erence)?)|BKG\s*(no)?)\b/i, /[A-Z0-9]{6,20}/i), 0.8);
    put(o, 'vessel', valueAfter(t, /\b(vessel(\s*\/\s*voyage)?|mother\s+vessel|feeder\s+vessel)\b/i, /[A-Z][A-Z0-9 /.-]{3,40}/i), 0.6);
    put(o, 'etd', valueAfter(t, /\b(ETD|estimated\s+time\s+of\s+departure|sailing\s+date)\b/i, DATE_RX), 0.65, 'date');
    put(o, 'eta', valueAfter(t, /\b(ETA|estimated\s+time\s+of\s+arrival)\b/i, DATE_RX), 0.65, 'date');
    put(o, 'containerCount', valueAfter(t, /(\d+)\s*[x×]\s*20/i, /\d+/), 0.6, 'number');
    if (!o.containerCount) {
      const m = /(\d{1,3})\s*[x×X]\s*(?:20|40)['’]?\s*(?:FT|DC|GP|HC|FEET|DRY)?/i.exec(t);
      if (m) o.containerCount = { value: m[1], confidence: 0.65, evidence: m[0], source: 'rule' };
    }
  },
  bill_of_lading: (t, o) => {
    put(o, 'blNumber', valueAfter(t, /\b(B\/L\s*(No|Number)|Bill\s+of\s+Lading\s+(No|Number)|BL\s*No)\b\.?/i, /(?=[A-Z]*\d)[A-Z]{2,6}[A-Z0-9O]{5,16}/i), 0.8);
    if (o.blNumber) o.blNumber.value = fixCode(o.blNumber.value.toUpperCase());
    put(o, 'blDate', valueAfter(t, /\b(shipped\s+on\s+board|on\s+board\s+date|date\s+of\s+issue|place\s+and\s+date\s+of\s+issue|B\/L\s+date)\b/i, DATE_RX), 0.65, 'date');
    put(o, 'vessel', valueAfter(t, /\b(vessel\s+(and\s+)?voyage(\s+no)?|ocean\s+vessel|vessel)\b/i, /[A-Z][A-Z0-9 /.-]{3,40}/i), 0.6);
    put(o, 'portOfLoading', valueAfter(t, /\bport\s+of\s+loading\b/i, /[A-Z][A-Za-z ,]{2,40}/), 0.6);
    put(o, 'portOfDischarge', valueAfter(t, /\bport\s+of\s+discharge\b/i, /[A-Z][A-Za-z ,]{2,40}/), 0.6);
    const n = /(\d{1,3})\s*[x×X]\s*(?:20|40)['’]?\s*(?:FT|DC|GP|HC|FEET|DRY)?\s*(?:DRY\s+)?CONTAINERS?/i.exec(t);
    if (n) o.containerCount = { value: n[1], confidence: 0.8, evidence: n[0], source: 'rule' };
    const refs = findRefs(t);
    if (refs.containers.length) o.containers = { value: refs.containers.join(', '), confidence: 0.85, evidence: refs.containers.slice(0, 3).join(', '), source: 'rule' };
    if (!o.containerCount && refs.containers.length) o.containerCount = { value: String(refs.containers.length), confidence: 0.6, evidence: `${refs.containers.length} container numbers`, source: 'rule' };
    if (/\bdraft\b/i.test(t.slice(0, 3000))) o.isDraft = { value: 'yes', confidence: 0.7, evidence: 'draft', source: 'rule' };
    const line = /\b(maersk|msc|cma\s?cgm|hapag|one\b|cosco|evergreen|yang\s?ming|pil\b|zim\b|hmm\b|unifeeder|folk|emirates\s+shipping|tss|tass|sci\b|x-press|wan\s?hai)/i.exec(t.slice(0, 4000));
    if (line) o.shippingLine = { value: line[1].toUpperCase().replace(/\s+/g, ' '), confidence: 0.6, evidence: line[0], source: 'rule' };
    const gw = /(\d{2,3}[,.]?\d{3}(?:\.\d+)?)\s*(?:KGS?|kg)\b/.exec(t);
    if (gw) put(o, 'grossWeightKg', { value: gw[1], evidence: gw[0] }, 0.4, 'number');
  },
  shipping_bill: (t, o) => {
    // ICEGATE layout: "Port Code SB No SB Date INMUN1 1234567 29-SEP-26"
    const m = /Port\s+Code\s+SB\s+No\s+SB\s+Date\s+([A-Z]{5}\d)\s+(\d{6,8})\s+(\d{1,2}-[A-Z]{3}-\d{2,4})/i.exec(t.replace(/\s+/g, ' '));
    if (m) {
      o.portCode = { value: m[1], confidence: 0.95, evidence: m[0], source: 'rule' };
      o.sbNumber = { value: m[2], confidence: 0.95, evidence: m[0], source: 'rule' };
      const d = parseDocDate(m[3]);
      if (d) o.sbDate = { value: d, confidence: 0.95, evidence: m[0], source: 'rule' };
    }
    put(o, 'sbNumber', valueAfter(t, /\b(SB\s*No|Shipping\s+Bill\s+No)\b\.?/i, /\d{6,8}/), 0.8);
    put(o, 'sbDate', valueAfter(t, /\b(SB\s*Date|Shipping\s+Bill\s+Date)\b/i, DATE_RX), 0.75, 'date');
    // "9.LEO 29-SEP-26 14:18" in the process details block
    const leo = /\bLEO\s+(\d{1,2}-[A-Z]{3}-\d{2,4})/i.exec(t.replace(/\s+/g, ' '));
    if (leo) o.leoDate = { value: parseDocDate(leo[1])!, confidence: 0.85, evidence: leo[0], source: 'rule' };
  },
  export_invoice: (t, o) => {
    const own = findRefs(t).invoiceNumbers[0];
    put(o, 'invoiceNumber', valueAfter(t, /\b(Export\s+Invoice\s+No|Invoice\s+No)\b\.?/i, REF_RX), 0.85);
    if (own) o.invoiceNumber = { value: own, confidence: 0.95, evidence: own, source: 'rule' };
    // the invoice date sits right after our invoice number ("ABC/EX/26-27/7 | 46277" in the .xls)
    if (own) {
      const d = new RegExp(own.replace(/[/]/g, '\\s*/\\s*') + '\\s*[|,]?\\s*(?:dt\\.?|date[:\\s-]*)?\\s*(' + DATE_RX.source + ')', 'i').exec(t);
      const v = d ? parseDocDate(d[1]) : null;
      if (v) o.invoiceDate = { value: v, confidence: 0.9, evidence: d![0], source: 'rule' };
    }
    put(o, 'invoiceDate', valueAfter(t, /\b(Invoice\s+Date|Inv\.?\s+Dt|Dated?)\b/i, DATE_RX, DATE_SKIP), 0.55, 'date');
    // our invoice prints each total under its label; the invoice value is the largest of them (CFR ≥ FOB)
    const totals = [/\bTotal\s+(?:Value\s+after\s+Tax|CIF\s+Value|CFR\s+Value|FOB\s+Value)\b[^0-9]{0,40}/i, /\bAmount\s+Chargeable(?:\s*\(in\s+words\))?/i, /\bFOB\s+value\s+in\s+(?:Dollar|USD|US\$)/i]
      .map((label) => valueAfter(t, label, TOTAL_RX))
      .filter((x): x is { value: string; evidence: string } => !!x)
      .map((x) => ({ ...x, amount: Number(parseAmount(x.value) ?? 0) }))
      .filter((x) => x.amount >= 1000)
      .sort((a, b) => b.amount - a.amount);
    if (totals[0]) o.amount = { value: String(totals[0].amount), confidence: 0.85, evidence: totals[0].evidence.slice(0, 200), source: 'rule' };
    put(o, 'quantityMt', valueAfter(t, /\bTotal\s+Net\s+Weight(?:\s*\(\s*M\.?T\.?S?\s*\))?/i, /\d[\d,]*(?:\.\d+)?/), 0.85, 'number');
    // totals line: "TOTAL VALUE … | 120.500 | 123,456.00" (quantity first, amount largest)
    for (const l of t.split(/\r?\n/)) {
      if (!/\b(total\s+value|total\s+amount|grand\s+total|FOB\s+value\s+in\s+(dollar|US))/i.test(l)) continue;
      const nums = [...l.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((x) => Number(x[0].replace(/,/g, ''))).filter((n) => n > 0);
      if (!nums.length) continue;
      const amount = Math.max(...nums);
      if (amount >= 1000 && !o.amount) o.amount = { value: String(amount), confidence: 0.75, evidence: l.trim().slice(0, 200), source: 'rule' };
      const qty = nums.find((n) => n < amount && n < 100000 && n !== amount);
      if (qty && nums.length >= 2 && !o.quantityMt && /total\s+value/i.test(l)) o.quantityMt = { value: String(qty), confidence: 0.7, evidence: l.trim().slice(0, 200), source: 'rule' };
    }
    put(o, 'quantityMt', valueAfter(t, /\b(Net\s+Weight|Quantity\s+in\s+MT|Total\s+Quantity)\b/i, /\d[\d,]*(?:\.\d+)?(?=\s*(?:MT|M\.T|MTS)\b)/i), 0.7, 'number');
    put(o, 'amount', valueAfter(t, /\b(FOB\s+value\s+in\s+Dollar|Total\s+(amount|value|invoice)|Amount\s+in\s+(US\$|USD))\b/i, TOTAL_RX), 0.6, 'money');
    const n = /(\d{1,3})\s*[xX]\s*20\s*['’]?\s*(?:FCL|FEET|FT)/.exec(t);
    if (n) o.containerCount = { value: n[1], confidence: 0.8, evidence: n[0], source: 'rule' };
    put(o, 'batchNo', valueAfter(t, /\bBATCH\s+NO\.?/i, /[0-9][0-9/A-Z-]{2,15}/i), 0.8);
  },
  vendor_po: (t, o) => {
    put(o, 'vendorPoNo', valueAfter(t, /\b(Voucher\s+No|PO\s*No|Purchase\s+Order\s+No)\b\.?/i, /[A-Z0-9][A-Z0-9/-]{0,20}/i), 0.7);
    put(o, 'vendorName', valueAfter(t, /\bSupplier\s*\(Bill\s+from\)/i, /[A-Z][A-Za-z0-9&.,()' -]{3,60}/), 0.75);
    put(o, 'poDate', valueAfter(t, /\b(Dated|Date)\b/i, DATE_RX), 0.6, 'date');
    put(o, 'totalAmount', valueAfter(t, /\bTotal\b/i, MONEY_RX), 0.5, 'money');
  },
};
const certRule: Rule = (t, o) => {
  put(o, 'certificateNo', valueAfter(t, /\b(Certificate\s+(No|Number)|Cert\.?\s*No|Ref(erence)?\s*No|Serial\s+No)\b\.?/i, REF_RX), 0.65);
  put(o, 'certificateDate', valueAfter(t, /\b(Date\s+of\s+issue|Issue\s+date|Place\s+and\s+date)\b/i, DATE_RX), 0.7, 'date');
  put(o, 'certificateDate', valueAfter(t, /\b(Dated?)\b/i, DATE_RX, DATE_SKIP), 0.5, 'date');
  put(o, 'reportNo', valueAfter(t, /\b(Report\s+(No|Number)|Test\s+Report\s+No|Sample\s+(No|ID))\b\.?/i, REF_RX), 0.65);
  put(o, 'reportDate', valueAfter(t, /\b(Report\s+Date|Date\s+of\s+report|Issue\s+Date)\b/i, DATE_RX), 0.65, 'date');
  put(o, 'reportDate', valueAfter(t, /\b(Date)\b/i, DATE_RX, DATE_SKIP), 0.45, 'date');
  const refs = findRefs(t);
  if (refs.containers.length) o.containers ??= { value: refs.containers.join(', '), confidence: 0.8, evidence: refs.containers.slice(0, 3).join(', '), source: 'rule' };
};
for (const k of ['packing_list', 'certificate_of_origin', 'phytosanitary', 'fumigation', 'health_certificate', 'test_report', 'apeda', 'certificate_of_conformity', 'bill_of_exchange', 'eia_intimation', 'traceability']) RULES[k] = certRule;
RULES.bill_of_exchange = (t, o) => {
  certRule(t, o);
  put(o, 'amount', valueAfter(t, /\b(Exchange\s+for|Please\s+pay)\b/i, /(?:US\$|USD|EUR)?\s?\d[\d,.]+/i), 0.75, 'money');
};

// ------------------------------------------------------------------ learned templates

export interface LayoutTemplate {
  field: string;
  /** Text right before the value on its line (or the whole previous line when the value starts a line). */
  anchor: string;
  /** Where the value sits relative to the anchor. */
  position: 'same-line' | 'next-line';
  /** A single token ("ACM-555001") or words ("ACME STAR / 12E"): how far the value runs. */
  shape?: 'token' | 'phrase';
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A short signature of the document layout, so a learned template only applies to the same sender's format. */
export function layoutFingerprint(text: string, kind: string): string {
  const words = lines(text)
    .slice(0, 12)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 3 && !/^(page|date|from|with|this|that|order|purchase|invoice|bill|lading|certificate|number)$/.test(w));
  return `${kind}:${[...new Set(words)].slice(0, 6).sort().join('-')}`;
}

/** After a user fixes a value, remember the label in front of it (so next time it is read from there). */
export function learnTemplate(text: string, field: string, value: string): LayoutTemplate | null {
  const v = norm(value);
  if (v.length < 2) return null;
  const ls = lines(text);
  for (let i = 0; i < ls.length; i++) {
    const at = ls[i].toLowerCase().indexOf(v.toLowerCase());
    if (at < 0) continue;
    const before = norm(ls[i].slice(0, at)).replace(/[\s:#.\-–=|]+$/, '');
    const shape = /\s/.test(v) ? 'phrase' : 'token';
    if (before.length >= 3) return { field, anchor: before.slice(-40), position: 'same-line', shape };
    if (i > 0 && ls[i - 1].length >= 3) return { field, anchor: norm(ls[i - 1]).slice(-40), position: 'next-line', shape };
  }
  return null;
}

/** Read a field with a learned template; the value's shape follows the field type. */
export function applyTemplate(text: string, t: LayoutTemplate, type: IntakeFieldType): Extracted | null {
  // a token stops at the first space; a phrase runs over single spaces up to a column break ("|" or two spaces)
  const words = t.shape === 'token' ? /[A-Z0-9][^\s|]{0,60}/i : /[A-Z0-9][A-Za-z0-9/&.,'()-]*(?: [A-Za-z0-9/&.,'()-]+){0,8}/i;
  const pattern = type === 'date' ? DATE_RX : type === 'number' || type === 'money' ? MONEY_RX : words;
  const ls = lines(text);
  const anchorRx = new RegExp(escapeRx(t.anchor).replace(/\\? /g, '\\s*'), 'i');
  for (let i = 0; i < ls.length; i++) {
    const m = anchorRx.exec(ls[i]);
    if (!m) continue;
    const src = t.position === 'same-line' ? ls[i].slice(m.index + m[0].length).replace(/^[\s:#.\-–=|]+/, '') : (ls[i + 1] ?? '');
    const hit = pattern.exec(src);
    if (!hit) continue;
    let value: string | null = hit[0].trim();
    if (type === 'date') value = parseDocDate(value);
    else if (type === 'number' || type === 'money') value = parseAmount(value);
    if (value) return { value, confidence: 0.9, evidence: `${ls[i]}${t.position === 'next-line' ? ` / ${src}` : ''}`.slice(0, 300), source: 'template' };
  }
  return null;
}

/** Run the rules (and learned templates, which win) for a document kind. */
export function extract(text: string, kindKey: string, templates: LayoutTemplate[] = []): ExtractionResult {
  const kind = intakeKind(kindKey);
  const fields: Record<string, Extracted> = {};
  for (const t of templates) {
    const def = kind.fields.find((x) => x.key === t.field);
    const hit = applyTemplate(text, t, def?.type ?? 'text');
    if (hit) fields[t.field] = hit;
  }
  RULES[kind.key]?.(text, fields);
  common(text, fields);
  // keep only fields this kind shows (plus the matching references)
  const keep = new Set([...kind.fields.map((x) => x.key), 'invoiceNumber', 'buyerPoRef', 'batchNo', 'lcNumber']);
  for (const k of Object.keys(fields)) if (!keep.has(k)) delete fields[k];
  const result: ExtractionResult = { fields, lines: kind.action === 'order' ? extractLines(text) : [], refs: findRefs(text) };
  const lineAmount = result.lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  if (lineAmount > 0 && (!fields.totalAmount || fields.totalAmount.source === 'rule')) {
    fields.totalAmount = { value: String(Math.round(lineAmount * 100) / 100), confidence: 0.85, evidence: `sum of ${result.lines.length} item lines`, source: 'rule' };
  }
  if (result.lines.length && !fields.totalQuantityMt) {
    const total = result.lines.reduce((s, l) => s + Number(l.quantityMt ?? 0), 0);
    if (total > 0) fields.totalQuantityMt = { value: String(Math.round(total * 1000) / 1000), confidence: 0.8, evidence: `sum of ${result.lines.length} item lines`, source: 'rule' };
  }
  return result;
}

/** Statuses of an inbox item. */
export const INTAKE_STATUSES = ['QUEUED', 'READING', 'TO_REVIEW', 'CONFIRMED', 'IGNORED', 'FAILED'] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];
