/**
 * Orders — the starting point: one line per PO / PI with where it stands and what to do next.
 * Open one to see everything that belongs to it (lots, documents, packaging, freight, payments).
 */
import { formatAmount } from '@rmm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, FileUp, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Chip, SourceChip, SourceFilter } from '../../components/OrderGroups';
import { Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { useSession } from '../../lib/session';
import { useDebounced } from '../MasterListPage';
import { NEXT_STEP, type OrderRow } from './orderTypes';

const TABS = [
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export function OrderListPage() {
  const { session, can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? 'running';
  const page = Number(params.get('page') ?? 1);
  const source = params.get('source') ?? '';
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const [sel, setSel] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ['order-files', state, source, debounced, page],
    queryFn: () => api.get<{ rows: OrderRow[]; total: number; pageSize: number; counts: Record<string, number> }>(`/order-files${qs({ state, source, search: debounced, page })}`),
    placeholderData: keepPreviousData,
    enabled: !!session?.activeCompany,
  });
  const rows = q.data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / (q.data?.pageSize ?? 25)));
  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
    setParams(n, { replace: true });
    setSel(0);
  };
  useEffect(() => {
    if (debounced !== (params.get('search') ?? '')) set({ search: debounced, page: '' });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useHotkeys(
    {
      '/': () => searchRef.current?.focus(),
      arrowdown: () => setSel((i) => Math.min(i + 1, rows.length - 1)),
      arrowup: () => setSel((i) => Math.max(i - 1, 0)),
      enter: () => rows[sel] && navigate(`/orders/${rows[sel].id}`),
      pagedown: () => page < pages && set({ page: String(page + 1) }),
      pageup: () => page > 1 && set({ page: String(page - 1) }),
      'alt+u': () => navigate('/inbox'),
      'alt+n': () => can('sales.proformaInvoices', 'create') && navigate('/d/proformaInvoices/new'),
      ...Object.fromEntries(TABS.map((t, i) => [`alt+${i + 1}`, () => set({ state: t.key, page: '' })])),
    },
    [rows, sel, page, pages, params],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Orders"
        subtitle="Every PO / PI is one file. Open it to see its lots, documents, packaging, freight and payments."
        actions={
          <>
            {can('sales.intake', 'create') && (
              <Button icon={<FileUp className="size-3.5" />} onClick={() => navigate('/inbox')} shortcut="alt+u">
                New order from a PO document
              </Button>
            )}
            {can('sales.proformaInvoices', 'create') && (
              <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => navigate('/d/proformaInvoices/new')} shortcut="alt+n">
                New PI / order
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="field-input pl-7"
            placeholder="Order, buyer, PO, LC, invoice, BL no.…  ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
                if (e.key === 'Enter' && rows.length === 1) navigate(`/orders/${rows[0].id}`);
              }
            }}
            aria-label="Search orders"
          />
        </div>
        <div className="flex gap-1" role="tablist">
          {TABS.map((t, i) => (
            <button key={t.key} role="tab" aria-selected={state === t.key} title={`Alt+${i + 1}`} onClick={() => set({ state: t.key, page: '' })} className={`rounded px-2.5 py-1 text-[12.5px] ${state === t.key ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {t.label} <span className={state === t.key ? 'text-white/70' : 'text-slate-400'}>{q.data?.counts[t.key] ?? ''}</span>
            </button>
          ))}
        </div>
        <SourceFilter value={source} onChange={(v) => set({ source: v, page: '' })} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !rows.length ? (
          <Card className="p-8 text-center text-[13px] text-slate-500">{debounced ? 'No order matches that search.' : 'No orders here. Drop a buyer PO in the Document inbox, or make a PI.'}</Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-[12px] text-slate-500">
                <tr>
                  {['Order', 'Buyer', 'Quantity', 'Lots shipped', 'Documents', 'What to do next', ''].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = r.progress;
                  const step = NEXT_STEP[p.next];
                  return (
                    <tr
                      key={r.id}
                      aria-selected={i === sel}
                      onClick={() => navigate(`/orders/${r.id}`)}
                      ref={(el) => {
                        if (i === sel) el?.scrollIntoView({ block: 'nearest' });
                      }}
                      className={`cursor-pointer border-t border-slate-100 align-top ${i === sel ? 'bg-brand-50 outline-2 -outline-offset-2 outline-brand-600/40' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="font-mono font-semibold text-brand-700">{r.number}</div>
                        <div className="text-[11.5px] text-slate-500">
                          <SourceChip source={r.orderSource} />
                          {r.buyerPoRef ? ` PO ${r.buyerPoRef}` : ''} · {r.date}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">{r.buyer ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                        {formatAmount(r.totalMt, 3)} MT
                        <div className="text-[11.5px] text-slate-500">
                          {r.currency} {formatAmount(r.amount, 0)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Meter done={p.shipped} of={p.lots} empty="Not planned" />
                        {p.nextShipDate && <div className="text-[11.5px] text-slate-500">next ship {p.nextShipDate}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Meter done={p.docsDone} of={p.docsNeeded} empty="—" />
                        {p.toReview > 0 && <Chip tone="amber">{p.toReview} to check</Chip>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Chip tone={step.tone}>{step.label}</Chip>
                        {p.alerts.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-[11.5px] text-amber-700" title={p.alerts.join('\n')}>
                            <AlertTriangle className="size-3" /> {p.alerts[0]}
                            {p.alerts.length > 1 && ` (+${p.alerts.length - 1})`}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <ChevronRight className="size-4 text-slate-400" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-400">
          <span className="max-md:hidden">/ search · ↑ ↓ choose · Enter open the order · Alt+1–3 tabs · PageUp / PageDown pages</span>
          {pages > 1 && (
            <span className="ml-auto flex items-center gap-2 text-slate-500">
              page {page} of {pages}
              <Button disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                Previous
              </Button>
              <Button disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
                Next
              </Button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function Meter({ done, of, empty }: { done: number; of: number; empty: string }) {
  if (!of) return <span className="text-[12px] text-slate-400">{empty}</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${done >= of ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.round((done / of) * 100)}%` }} />
      </div>
      <span className="text-[12px] text-slate-600 tabular-nums">
        {done}/{of}
      </span>
    </div>
  );
}
