/**
 * URL-synced MIS filter shared by every MIS page. Date presets resolve to a concrete from/to
 * (Indian financial year = 1 Apr–31 Mar). Only fields the platform actually records are exposed.
 */
import { formatAmount } from '@rmm/shared';
import { useSearchParams } from 'react-router';

/** Reporting currency for MIS money figures. USD by default; ₹ on request (remembered per browser). */
export type MisCurrency = 'USD' | 'INR';
const CCY_KEY = 'mis.ccy';
const storedCcy = (): MisCurrency => {
  try {
    return localStorage.getItem(CCY_KEY) === 'INR' ? 'INR' : 'USD';
  } catch {
    return 'USD';
  }
};

/** Compact axis labels: $ 1.2M / $ 450k, or ₹ in lakh / crore. */
export function compactMoney(v: number, ccy: MisCurrency): string {
  const a = Math.abs(v);
  if (ccy === 'INR') {
    if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
    if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  } else {
    if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  }
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}

export interface MisFilterParams {
  preset: string;
  from: string;
  to: string;
  buyerId: string;
  destinationCountryId: string;
  productId: string;
  variety: string;
  currencyId: string;
  status: string;
  ccy: MisCurrency;
}

const KEYS: (keyof MisFilterParams)[] = ['preset', 'from', 'to', 'buyerId', 'destinationCountryId', 'productId', 'variety', 'currencyId', 'status', 'ccy'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fyStart = (y: number) => `${y}-04-01`;
const fyEnd = (y: number) => `${y + 1}-03-31`;

export const DATE_PRESETS: { key: string; label: string; range: () => { from: string; to: string } }[] = [
  { key: 'all', label: 'All time', range: () => ({ from: '', to: '' }) },
  { key: 'mtd', label: 'This month', range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), n.getMonth(), 1)), to: iso(n) }; } },
  { key: '30d', label: 'Last 30 days', range: () => { const n = new Date(); const s = new Date(n); s.setDate(n.getDate() - 29); return { from: iso(s), to: iso(n) }; } },
  { key: '90d', label: 'Last 90 days', range: () => { const n = new Date(); const s = new Date(n); s.setDate(n.getDate() - 89); return { from: iso(s), to: iso(n) }; } },
  { key: 'fy', label: 'This FY', range: () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return { from: fyStart(y), to: fyEnd(y) }; } },
  { key: 'pfy', label: 'Last FY', range: () => { const n = new Date(); const y = (n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1) - 1; return { from: fyStart(y), to: fyEnd(y) }; } },
];

export interface MisFilterApi {
  params: MisFilterParams;
  /** query string (leading `?`) for the MIS endpoints */
  query: string;
  set: (key: keyof MisFilterParams, value: string) => void;
  setPreset: (key: string) => void;
  reset: () => void;
  active: number; // count of non-date filters applied
  /** Reporting currency and its money formatters. */
  ccy: MisCurrency;
  sym: '$' | '₹';
  setCcy: (c: MisCurrency) => void;
  /** Full money label, e.g. "$ 1,234,567". */
  fmt: (v: string | number) => string;
  /** Short axis label, e.g. "1.2M" or "4.5Cr". */
  tick: (v: number) => string;
}

export function useMisFilter(): MisFilterApi {
  const [sp, setSp] = useSearchParams();
  const get = (k: keyof MisFilterParams) => sp.get(k) ?? '';
  const params: MisFilterParams = {
    preset: get('preset') || 'fy',
    from: get('from'),
    to: get('to'),
    buyerId: get('buyerId'),
    destinationCountryId: get('destinationCountryId'),
    productId: get('productId'),
    variety: get('variety'),
    currencyId: get('currencyId'),
    status: get('status'),
    ccy: get('ccy') === 'INR' ? 'INR' : get('ccy') === 'USD' ? 'USD' : storedCcy(),
  };
  // default preset (this FY) applies its range when no explicit dates are set
  if (!sp.has('from') && !sp.has('to') && !sp.has('preset')) {
    const r = DATE_PRESETS.find((p) => p.key === 'fy')!.range();
    params.from = r.from;
    params.to = r.to;
  }

  const write = (next: Partial<MisFilterParams>) => {
    const merged = { ...params, ...next };
    const n = new URLSearchParams();
    for (const k of KEYS) {
      const v = merged[k];
      if (v && !(k === 'ccy' && v === 'USD')) n.set(k, v);
    }
    setSp(n, { replace: true });
  };

  const set = (key: keyof MisFilterParams, value: string) => write({ [key]: value } as Partial<MisFilterParams>);
  const setPreset = (key: string) => {
    const p = DATE_PRESETS.find((x) => x.key === key);
    if (!p) return;
    const r = p.range();
    write({ preset: key, from: r.from, to: r.to });
  };
  const reset = () => setSp(params.ccy === 'INR' ? new URLSearchParams({ ccy: 'INR' }) : new URLSearchParams(), { replace: true });
  const setCcy = (c: MisCurrency) => {
    try {
      localStorage.setItem(CCY_KEY, c);
    } catch {
      /* not remembered in private mode */
    }
    write({ ccy: c });
  };

  const query =
    '?' +
    (['from', 'to', 'buyerId', 'destinationCountryId', 'productId', 'variety', 'currencyId', 'status', 'ccy'] as const)
      .filter((k) => params[k])
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join('&');

  const active = (['buyerId', 'destinationCountryId', 'productId', 'variety', 'currencyId', 'status'] as const).filter((k) => params[k]).length;

  const ccy = params.ccy;
  const sym = ccy === 'INR' ? '₹' : '$';
  return {
    params,
    query: query === '?' ? '' : query,
    set,
    setPreset,
    reset,
    active,
    ccy,
    sym,
    setCcy,
    fmt: (v) => `${sym} ${formatAmount(String(v), 0)}`,
    tick: (v) => compactMoney(v, ccy),
  };
}
