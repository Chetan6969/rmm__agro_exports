/**
 * Two things buyer POs carry besides their item lines:
 *  - a delivery schedule table (SKU "4 × 10 KG" × destination city × month × priority P1 / P2), used to
 *    split each item line into dated shipments with the right packing;
 *  - sentences naming whom to buy packaging from ("procure the bags from X and seals from Y"), used to
 *    pre-fill the supplier on the packaging lines.
 */
import type { ExtractedLine } from './intake.js';
import type { PackagingComponent } from './planning.js';

// ------------------------------------------------------------------ delivery schedule

export interface ScheduleRow {
  /** Inner packs per outer bag (4 in "4 × 10 KG"). */
  inner: number;
  /** Kilograms of one inner pack (10 in "4 × 10 KG"). */
  unitKg: number;
  cities: Record<string, number>;
  /** Month name and priority as printed, e.g. "Jan 2027 · P2". */
  label: string;
  dispatchBy: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const num = (s: string) => Number(s.replace(/,/g, ''));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Priority P1 = on board by the 15th, P2 (or later) = by the end of the month. */
export function parseDeliverySchedule(text: string): ScheduleRow[] {
  const at = (text ?? '').search(/delivery\s+schedule(?![\s\S]*delivery\s+schedule)/i);
  if (at < 0) return [];
  const section = text.slice(at);
  const header = /\bSKU\b([\s\S]{2,160}?)\bTotal\b/i.exec(section);
  if (!header) return [];
  let cities = header[1]
    .split(/\r?\n|\t|\s{2,}|\|/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (cities.length === 1) cities = cities[0].split(/\s+/);
  if (!cities.length || cities.length > 12) return [];
  const flat = section.replace(/[|]/g, ' ').replace(/\s+/g, ' ');
  const row = new RegExp(
    `(\\d{1,3})\\s*[xX×*]\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*KGS?\\.?\\s+((?:\\d[\\d,]*(?:\\.\\d+)?\\s+){${cities.length + 1}})([A-Za-z]{3})[A-Za-z]*[-\\s'’.]*(\\d{2,4})\\s+P\\s?([1-4])`,
    'g',
  );
  const out: ScheduleRow[] = [];
  for (const m of flat.matchAll(row)) {
    const month = MONTHS.indexOf(m[4].toLowerCase()) + 1;
    if (!month) continue;
    const year = m[5].length === 2 ? 2000 + Number(m[5]) : Number(m[5]);
    const values = m[3].trim().split(/\s+/).map(num);
    const p = Number(m[6]) === 1 ? 1 : 2;
    const day = p === 1 ? 15 : new Date(Date.UTC(year, month, 0)).getUTCDate();
    out.push({
      inner: Number(m[1]),
      unitKg: Number(m[2]),
      cities: Object.fromEntries(cities.map((c, i) => [c.toLowerCase(), values[i]])),
      label: `${m[4]} ${year} · P${p}`,
      dispatchBy: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    });
  }
  return out;
}

export const packingLabel = (inner: number, unitKg: number) => (inner > 1 ? `${inner} × ${unitKg} KG` : `${unitKg} KG`);

/**
 * Split each item line by the schedule rows of its pack and destination. The PO's own quantity stays
 * authoritative: a small difference goes to the last part. Lines the schedule does not explain
 * (no match, or more than the PO's ±10 % apart) are left as they are.
 */
export function applySchedule(lines: ExtractedLine[], schedule: ScheduleRow[]): ExtractedLine[] {
  if (!schedule.length) return lines;
  const key = (l: ExtractedLine) => `${l.packKg}|${(l.port ?? '').toLowerCase()}`;
  return lines.flatMap((l) => {
    const qty = Number(l.quantityMt ?? 0);
    const port = (l.port ?? '').toLowerCase();
    // two PO lines for the same pack and city cannot be told apart in the schedule
    if (!qty || !port || !l.packKg || lines.filter((x) => key(x) === key(l)).length > 1) return [l];
    const cityQty = (r: ScheduleRow) => Object.entries(r.cities).find(([c]) => c.startsWith(port) || port.startsWith(c))?.[1] ?? 0;
    const byUnit = schedule.filter((r) => r.unitKg === l.packKg && cityQty(r) > 0);
    const rows = byUnit.length ? byUnit : schedule.filter((r) => r.inner * r.unitKg === l.packKg && cityQty(r) > 0);
    if (!rows.length) return [l];
    const total = rows.reduce((s, r) => s + cityQty(r), 0);
    if (Math.abs(total - qty) > qty * 0.1) return [l];
    let left = qty;
    const parts = rows.map((r, i) => {
      const q = i === rows.length - 1 ? r3(left) : cityQty(r);
      left = r3(left - q);
      return { r, q };
    });
    if (parts.some((p) => p.q <= 0)) return [l];
    return parts.map(({ r, q }) => {
      const packing = packingLabel(r.inner, r.unitKg);
      return {
        ...l,
        packing,
        packKg: r.inner * r.unitKg,
        description: `${l.description} (${packing}, ${r.label})`,
        quantityMt: String(q),
        amount: l.rate ? String(Math.round(q * Number(l.rate) * 100) / 100) : l.amount,
        dispatchBy: r.dispatchBy,
      };
    });
  });
}

// ------------------------------------------------------------------ packaging suppliers named in a PO

export interface SupplierHint {
  /** What to buy, as written ("Jute Bags", "seal"). */
  item: string;
  supplier: string;
}

export function componentsFor(item: string): PackagingComponent[] {
  const s = item.toLowerCase();
  if (/packaging\s+material|packing\s+material/.test(s)) return ['outer', 'inner', 'tag', 'strip', 'seal'];
  const out: PackagingComponent[] = [];
  if (/inner|pouch/.test(s)) out.push('inner');
  if (/(?<!inner )\b(bags?|sacks?|jute|bopp|liners?)\b/.test(s)) out.push('outer');
  if (/\btags?\b|\blabels?\b/.test(s)) out.push('tag');
  if (/\bstrips?\b|\btapes?\b/.test(s)) out.push('strip');
  if (/\bseals?\b/.test(s)) out.push('seal');
  return out;
}

export function findSupplierHints(text: string): SupplierHint[] {
  const out: SupplierHint[] = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    const verb = /\b(procure|purchase|source|buy)\b(?!\s+order)/i.exec(line);
    if (!verb) continue;
    const clause = line.slice(verb.index + verb[0].length);
    const rx = /([A-Za-z][A-Za-z -]{0,50}?)\s+from\s+(?:M\/s\.?\s+)?([A-Za-z][A-Za-z0-9&'() -]{2,60}?)(?=\s*(?:,|;|\.(?:\s|$)|\s+and\s+[A-Za-z -]{2,30}?\s+from\b|$))/gi;
    for (const m of clause.matchAll(rx)) {
      const item = m[1].replace(/^(?:\s*(?:and|also|the|all|our)\b)+/i, '').trim();
      if (item && componentsFor(item).length) out.push({ item, supplier: m[2].trim() });
    }
  }
  return out;
}

export const supplierHintText = (hints: SupplierHint[]) => hints.map((h) => `${h.item}: ${h.supplier}`).join('; ');

export function parseSupplierHintText(s: string | null | undefined): SupplierHint[] {
  return (s ?? '')
    .split(';')
    .map((part) => {
      const i = part.indexOf(':');
      return i < 0 ? null : { item: part.slice(0, i).trim(), supplier: part.slice(i + 1).trim() };
    })
    .filter((h): h is SupplierHint => !!h?.item && !!h.supplier);
}

const GENERIC = ['packaging', 'packing', 'packers', 'enterprises', 'enterprise', 'industries', 'traders', 'trading', 'company', 'private', 'limited'];
const SHORT_GENERIC = new Set(['co', 'pvt', 'ltd', 'llp', 'the', 'and', 'm', 's']);

/** True when two words differ by at most one letter (typos like "kamal" / "kamel"). */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [a.slice(i + 1) === b.slice(i + 1), a.slice(i) === b.slice(i + 1), a.slice(i + 1) === b.slice(i)].some(Boolean);
}

const words = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const distinctive = (name: string) => words(name).filter((w) => !SHORT_GENERIC.has(w) && !GENERIC.some((g) => near(w, g)));

/** The supplier master a written name refers to; null when none or more than one fits. */
export function matchSupplier<T extends { name: string }>(written: string, suppliers: T[]): T | null {
  const exact = suppliers.filter((s) => words(s.name).join(' ') === words(written).join(' '));
  if (exact.length) return exact[0];
  const want = distinctive(written);
  if (!want.length) return null;
  const hits = suppliers.filter((s) => {
    const have = distinctive(s.name);
    return want.every((w) => have.some((h) => near(w, h)));
  });
  return hits.length === 1 ? hits[0] : null;
}
