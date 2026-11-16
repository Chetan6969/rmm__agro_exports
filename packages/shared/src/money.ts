/**
 * Exact decimal arithmetic for quantities and money (no floating point), shared by the API
 * (authoritative totals) and the web app (live preview), so both always show the same figures.
 * Values travel as plain decimal strings, e.g. "1250.500".
 */

interface Dec {
  units: bigint;
  scale: number;
}

function parse(v: string | number | null | undefined): Dec {
  const text = v === null || v === undefined || v === '' ? '0' : typeof v === 'number' ? numberText(v) : v.trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`Invalid number "${text}"`);
  const fraction = m[3] ?? '';
  const units = BigInt(`${m[2] || '0'}${fraction}`);
  return { units: m[1] ? -units : units, scale: fraction.length };
}

function numberText(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid number ${n}`);
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Rescales with half-up rounding (away from zero for negatives). */
function rescale(d: Dec, scale: number): bigint {
  if (scale >= d.scale) return d.units * 10n ** BigInt(scale - d.scale);
  const div = 10n ** BigInt(d.scale - scale);
  const neg = d.units < 0n;
  const abs = neg ? -d.units : d.units;
  const q = (abs * 2n + div) / (div * 2n);
  return neg ? -q : q;
}

function text(units: bigint, scale: number): string {
  const neg = units < 0n;
  const s = (neg ? -units : units).toString().padStart(scale + 1, '0');
  const out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

export type DecimalInput = string | number | null | undefined;

/** True when the text is a plain decimal number. */
export const isDecimal = (v: unknown): boolean => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim());

/** Rounds half-up to `scale` decimals. */
export function round(v: DecimalInput, scale = 2): string {
  return text(rescale(parse(v), scale), scale);
}

/** a × b rounded half-up to `scale` decimals. */
export function mul(a: DecimalInput, b: DecimalInput, scale = 2): string {
  const x = parse(a);
  const y = parse(b);
  return text(rescale({ units: x.units * y.units, scale: x.scale + y.scale }, scale), scale);
}

/** Exact sum, returned at `scale` decimals. */
export function add(values: DecimalInput[], scale = 2): string {
  const parsed = values.map(parse);
  const s = Math.max(scale, ...parsed.map((p) => p.scale));
  const total = parsed.reduce((acc, p) => acc + rescale(p, s), 0n);
  return text(rescale({ units: total, scale: s }, scale), scale);
}

/** Exact a − b at `scale` decimals. */
export function sub(a: DecimalInput, b: DecimalInput, scale = 2): string {
  const y = parse(b);
  return add([a, text(-y.units, y.scale)], scale);
}

/** -1, 0 or 1. */
export function cmp(a: DecimalInput, b: DecimalInput): number {
  const x = parse(a);
  const y = parse(b);
  const s = Math.max(x.scale, y.scale);
  const d = rescale(x, s) - rescale(y, s);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

export const isPositive = (v: DecimalInput) => cmp(v, 0) > 0;

/** Display with thousands separators (en-IN grouping is not used: export documents are international). */
export function formatAmount(v: DecimalInput, scale = 2): string {
  const t = round(v, scale);
  const [int, frac] = t.replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${t.startsWith('-') ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

// ------------------------------------------------------------------ amount in words
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

const SCALES: [bigint, string][] = [
  [1_000_000_000_000n, 'Trillion'],
  [1_000_000_000n, 'Billion'],
  [1_000_000n, 'Million'],
  [1_000n, 'Thousand'],
];

/** International (million/billion) number words for a whole number. */
export function integerToWords(n: bigint): string {
  if (n === 0n) return 'Zero';
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${integerToWords(n / size)} ${name}`);
      n %= size;
    }
  }
  if (n > 0n) parts.push(belowThousand(Number(n)));
  return parts.join(' ');
}

export interface CurrencyWords {
  /** ISO code printed before the words, e.g. USD. */
  code: string;
  /** Number of minor-unit digits (2 for USD, 0 for JPY). */
  decimals?: number | null;
  /** Minor unit name from the currency master, e.g. Cents; when absent the fraction is written as "and 50/100". */
  subunitName?: string | null;
}

/** "USD Forty-Five Thousand Two Hundred and Cents Fifty Only". */
export function amountInWords(amount: DecimalInput, currency: CurrencyWords): string {
  const decimals = Math.max(0, Math.min(currency.decimals ?? 2, 4));
  const fixed = round(amount, decimals).replace('-', '');
  const [intPart, frac = ''] = fixed.split('.');
  let words = `${currency.code.toUpperCase()} ${integerToWords(BigInt(intPart))}`;
  if (frac && BigInt(frac) > 0n) {
    words += currency.subunitName?.trim()
      ? ` and ${currency.subunitName.trim()} ${integerToWords(BigInt(frac))}`
      : ` and ${frac}/${10 ** decimals}`;
  }
  return `${words} Only`;
}

// ------------------------------------------------------------------ incoterm charges
export const INCOTERMS = ['FOB', 'CFR', 'CIF'] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export const SHIPPING_CHARGE_FIELDS = [
  { name: 'thcCharge', label: 'THC' },
  { name: 'blCharge', label: 'BL charges' },
  { name: 'sealCharge', label: 'Seal charges' },
  { name: 'mucCharge', label: 'MUC' },
  { name: 'riskCharge', label: 'Risk charges' },
  { name: 'repositionCharge', label: 'Reposition charges' },
  { name: 'oceanFreightCharge', label: 'Ocean freight' },
  { name: 'insuranceCharge', label: 'Insurance' },
] as const;

export type ShippingChargeInput = Partial<Record<(typeof SHIPPING_CHARGE_FIELDS)[number]['name'], DecimalInput>>;

/**
 * Incoterm-driven shipping charges (the PR's "Rule 7"):
 *  FOB counts THC, BL, seal, MUC, risk and reposition charges;
 *  CFR adds ocean freight; CIF adds ocean freight and insurance.
 * Charges that do not apply to the incoterm count as zero.
 */
export function computeShippingCharges(incoterm: string, input: ShippingChargeInput) {
  const freightApplies = incoterm === 'CFR' || incoterm === 'CIF';
  const insuranceApplies = incoterm === 'CIF';
  const out = {
    thcCharge: round(input.thcCharge),
    blCharge: round(input.blCharge),
    sealCharge: round(input.sealCharge),
    mucCharge: round(input.mucCharge),
    riskCharge: round(input.riskCharge),
    repositionCharge: round(input.repositionCharge),
    oceanFreightCharge: freightApplies ? round(input.oceanFreightCharge) : '0.00',
    insuranceCharge: insuranceApplies ? round(input.insuranceCharge) : '0.00',
  };
  return { ...out, totalShippingCharge: add(Object.values(out)) };
}
