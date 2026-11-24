/**
 * Shared filter bar that sits at the top of every MIS page and actually drives the queries
 * (date presets + buyer / destination country / product / variety / currency / status). Choices are
 * loaded from real invoice data, so only buyers / countries / products that exist appear.
 */
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { DATE_PRESETS, type MisFilterApi } from '../lib/useMisFilter';

interface Options {
  buyers: { id: string; name: string }[];
  countries: { id: string; name: string }[];
  currencies: { id: string; code: string }[];
  products: { id: string; name: string; variety: string }[];
}

const STATUSES = ['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED'];
const sel = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] text-slate-700 shadow-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 focus:outline-none';

export function GlobalFilterBar({ f, enabled }: { f: MisFilterApi; enabled: boolean }) {
  const opts = useQuery({ queryKey: ['mis', 'filter-options'], queryFn: () => api.get<Options>('/mis/filter-options'), enabled });
  const o = opts.data;
  const varieties = Array.from(new Set((o?.products ?? []).map((p) => p.variety).filter(Boolean)));

  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        {/* date presets */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => f.setPreset(p.key)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${f.params.preset === p.key ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* custom dates */}
        <input type="date" value={f.params.from} onChange={(e) => f.set('from', e.target.value)} className={sel} aria-label="From date" />
        <span className="text-slate-400">–</span>
        <input type="date" value={f.params.to} onChange={(e) => f.set('to', e.target.value)} className={sel} aria-label="To date" />

        <div className="mx-1 h-6 w-px bg-slate-200" />

        <select value={f.params.buyerId} onChange={(e) => f.set('buyerId', e.target.value)} className={sel}>
          <option value="">All buyers</option>
          {o?.buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={f.params.destinationCountryId} onChange={(e) => f.set('destinationCountryId', e.target.value)} className={sel}>
          <option value="">All destinations</option>
          {o?.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={f.params.variety} onChange={(e) => f.set('variety', e.target.value)} className={sel}>
          <option value="">All varieties</option>
          {varieties.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={f.params.productId} onChange={(e) => f.set('productId', e.target.value)} className={sel}>
          <option value="">All products</option>
          {o?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.params.currencyId} onChange={(e) => f.set('currencyId', e.target.value)} className={sel}>
          <option value="">All currencies</option>
          {o?.currencies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select>
        <select value={f.params.status} onChange={(e) => f.set('status', e.target.value)} className={sel}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </select>

        {f.active > 0 && (
          <button onClick={f.reset} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-500 shadow-sm hover:bg-slate-100">
            <X className="size-3.5" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
