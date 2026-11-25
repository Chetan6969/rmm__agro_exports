/**
 * Financial year + document number formatting (shared so the UI can show a live preview).
 *
 * Pattern tokens:
 *   {CO}    company short code        RMM
 *   {FY}    short FY                  26-27
 *   {FYL}   long FY                   2026-27
 *   {YYYY}  calendar year of the doc  2026
 *   {MM}    month of the doc          04
 *   {SEQ}   running number            7
 *   {SEQ:4} zero padded               0007
 */
export interface FinancialYear {
  /** e.g. 2026 for FY 2026-27 */
  startYear: number;
  short: string;
  long: string;
  start: string;
  end: string;
}

export function financialYear(date: string | Date, startMonth = 4): FinancialYear {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m >= startMonth ? y : y - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  return {
    startYear,
    short: startMonth === 1 ? String(startYear).slice(2) : `${String(startYear).slice(2)}-${String(endYear).slice(2)}`,
    long: startMonth === 1 ? String(startYear) : `${startYear}-${String(endYear).slice(2)}`,
    start: `${startYear}-${pad(startMonth)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(lastDay(endYear, endMonth))}`,
  };
}

export function formatDocNumber(
  pattern: string,
  ctx: { companyCode: string; date: string | Date; seq: number; fyStartMonth?: number },
): string {
  const fy = financialYear(ctx.date, ctx.fyStartMonth ?? 4);
  const d = typeof ctx.date === 'string' ? new Date(`${ctx.date.slice(0, 10)}T00:00:00Z`) : ctx.date;
  return pattern.replace(/\{(CO|FYL|FY|YYYY|MM|SEQ)(?::(\d{1,2}))?\}/g, (_, tok: string, pad?: string) => {
    switch (tok) {
      case 'CO':
        return ctx.companyCode;
      case 'FY':
        return fy.short;
      case 'FYL':
        return fy.long;
      case 'YYYY':
        return String(d.getUTCFullYear());
      case 'MM':
        return String(d.getUTCMonth() + 1).padStart(2, '0');
      case 'SEQ':
        return String(ctx.seq).padStart(pad ? Number(pad) : 1, '0');
      default:
        return '';
    }
  });
}

/**
 * Checks a numbering pattern. A series that restarts every financial year must print the FY
 * ({FY} or {FYL}); otherwise each April would issue the same numbers again (INV/1, INV/2...).
 * {YYYY} is not enough: January–March belong to the previous FY but carry the new calendar year.
 */
export function validatePattern(pattern: string, resetYearly?: boolean): string | null {
  if (!/\{SEQ(:\d{1,2})?\}/.test(pattern)) return 'Pattern must contain {SEQ} or {SEQ:n}';
  const unknown = pattern.match(/\{(?!(CO|FYL|FY|YYYY|MM|SEQ)(:\d{1,2})?\})[^}]*\}/);
  if (unknown) return `Unknown token ${unknown[0]}`;
  if (resetYearly && !/\{FYL?\}/.test(pattern)) return 'A series that restarts every year must include {FY} or {FYL}';
  return null;
}

/**
 * Today's calendar date (YYYY-MM-DD) in the business time zone. Documents are dated in IST, so
 * the UTC date (toISOString) would put the first 5½ hours of 1 April in the previous FY.
 */
export function businessDate(now: Date = new Date(), timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Document types that get numbered. Transaction modules add theirs here. */
export const DOC_TYPES = [
  { key: 'enquiry', label: 'Enquiry', defaultPattern: 'ENQ/{CO}/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'sales_contract', label: 'Sales Contract', defaultPattern: '{CO}/SC/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'proforma_invoice', label: 'Proforma Invoice', defaultPattern: 'PI-{CO}/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'production_order', label: 'Production Order', defaultPattern: '{CO}/PRO/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'export_order', label: 'Export Order', defaultPattern: '{CO}/ORD/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'purchase_order', label: 'Purchase Order', defaultPattern: '{CO}/PO/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'commercial_invoice', label: 'Commercial Invoice', defaultPattern: '{CO}/EX/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'ocean_bill', label: 'Ocean Bill of Lading', defaultPattern: '{CO}/OBL/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'certificate', label: 'Certificate', defaultPattern: '{CO}/CERT/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'freight_enquiry', label: 'Freight enquiry', defaultPattern: '{CO}/FQ/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'packing_list', label: 'Packing List', defaultPattern: '{CO}/PL/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'freight_bill', label: 'Freight Bill', defaultPattern: '{CO}/FB/{FY}/{SEQ:3}', resetYearly: true },
  { key: 'payment_receipt', label: 'Payment Receipt', defaultPattern: '{CO}/RCPT/{FY}/{SEQ:4}', resetYearly: true },
] as const;

export type DocTypeKey = (typeof DOC_TYPES)[number]['key'];
