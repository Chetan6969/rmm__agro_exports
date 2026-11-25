import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ExternalLink, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/Modal';
import { Badge, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { useDebounced } from './MasterListPage';

interface BinRow {
  id: string;
  type: string;
  typeLabel: string;
  group: string;
  title: string | null;
  sub: string | null;
  deletedAt: string;
  deletedByName: string | null;
  reason: string | null;
  canRestore: boolean;
}
interface BinResult {
  rows: BinRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { type: string; label: string; group: string; count: number }[];
  deleters: { id: string; name: string }[];
  groups: string[];
}

const FILTERS = ['type', 'group', 'from', 'to', 'deletedBy', 'search'] as const;
type Filter = (typeof FILTERS)[number];

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(iso: string) {
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days > -1) return 'today';
  if (days > -31) return rtf.format(days, 'day');
  if (days > -365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

/** Where a restored record opens. */
function openPath(r: BinRow): string | null {
  if (['proformaInvoices', 'productionOrders', 'commercialInvoices', 'oceanBills', 'certificates'].includes(r.type)) return `/d/${r.type}/${r.id}`;
  if (r.type === 'freightEnquiries') return `/freight/${r.id}`;
  if (r.type === 'users') return `/admin/users/${r.id}`;
  if (r.type === 'roles') return '/admin/roles';
  if (r.type === 'sharing') return '/admin/sharing';
  if (r.type === 'shipments' || r.type === 'payments') return null;
  return `/m/${r.type}/${r.id}`;
}

/** Recycle bin: every deleted record, kept for good, with filters and restore. */
export function RecycleBinPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const get = (k: Filter) => params.get(k) ?? '';
  const [search, setSearch] = useState(get('search'));
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [restore, setRestore] = useState<BinRow | null>(null);

  const set = (k: Filter, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k === 'group') n.delete('type');
    setParams(n, { replace: true });
    setPage(1);
  };
  useEffect(() => {
    if (debounced !== get('search')) set('search', debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = { type: get('type'), group: get('group'), from: get('from'), to: get('to'), deletedBy: get('deletedBy'), search: get('search'), page, pageSize: 50 };
  const q = useQuery({
    queryKey: ['recycle-bin', query],
    queryFn: () => api.get<BinResult>(`/recycle-bin${qs(query)}`),
    placeholderData: keepPreviousData,
    enabled: !!session?.activeCompany,
  });
  const d = q.data;
  const types = useMemo(() => (d?.counts ?? []).filter((c) => !get('group') || c.group === get('group')), [d, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = FILTERS.filter((k) => get(k)).length;
  const pages = Math.max(1, Math.ceil((d?.total ?? 0) / 50));

  const doRestore = async () => {
    if (!restore) return;
    await api.post(`/recycle-bin/${restore.type}/${restore.id}/restore`);
    const path = openPath(restore);
    toast.success(`${restore.typeLabel} ${restore.title ?? ''} restored`, path ? { action: { label: 'Open', onClick: () => window.location.assign(path) } } : undefined);
    qc.invalidateQueries();
  };

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Recycle bin" subtitle="Deleted records are kept here for good — nothing is ever erased. Restore anything you have rights to delete." />
      <div className="space-y-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input className="field-input pl-7" placeholder="Name, number, code or reason…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search deleted records" />
          </div>
          <select className="field-input w-auto" value={get('group')} onChange={(e) => set('group', e.target.value)} aria-label="Section">
            <option value="">All sections</option>
            {(d?.groups ?? []).map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <select className="field-input w-auto" value={get('type')} onChange={(e) => set('type', e.target.value)} aria-label="Record type">
            <option value="">All record types</option>
            {types.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
          <select className="field-input w-auto" value={get('deletedBy')} onChange={(e) => set('deletedBy', e.target.value)} aria-label="Deleted by">
            <option value="">Deleted by anyone</option>
            {(d?.deleters ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1 text-[12.5px] text-slate-500">
            Deleted
            <input type="date" className="field-input w-auto" value={get('from')} onChange={(e) => set('from', e.target.value)} aria-label="Deleted from" />
            –
            <input type="date" className="field-input w-auto" value={get('to')} onChange={(e) => set('to', e.target.value)} aria-label="Deleted to" />
          </span>
          {active > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setParams(new URLSearchParams(), { replace: true });
              }}
              className="flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-slate-800"
            >
              <X className="size-3.5" /> Clear filters
            </button>
          )}
          <span className="ml-auto text-[12.5px] text-slate-500">
            {d ? `${d.total} deleted record${d.total === 1 ? '' : 's'}` : ''}
            {pages > 1 && ` · page ${page} of ${pages}`}
          </span>
        </div>
        {(d?.counts.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {d!.counts.map((c) => (
              <button
                key={c.type}
                type="button"
                onClick={() => set('type', get('type') === c.type ? '' : c.type)}
                className={`rounded-full border px-2 py-0.5 text-[11.5px] ${get('type') === c.type ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {c.label} · {c.count}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-5">
        {q.error && <ErrorBox error={q.error} />}
        {q.isLoading ? (
          <Spinner />
        ) : !d?.rows.length ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-slate-500">
            <Trash2 className="mx-auto mb-2 size-6 text-slate-300" />
            {active ? 'No deleted records match these filters.' : 'The recycle bin is empty.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-xs">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11.5px] text-slate-500 uppercase">
                  <th className="px-3 py-2">Record</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Deleted</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={`${r.type}:${r.id}`} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{r.title || '—'}</div>
                      {r.sub && <div className="text-[12px] text-slate-500">{r.sub}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge>{r.typeLabel}</Badge>
                      <div className="mt-0.5 text-[11px] text-slate-400">{r.group}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" title={new Date(r.deletedAt).toLocaleString()}>
                      {new Date(r.deletedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      <div className="text-[11.5px] text-slate-400">{ago(r.deletedAt)}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.deletedByName ?? '—'}</td>
                    <td className="max-w-72 px-3 py-2 text-slate-600">{r.reason ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-right">
                      {r.canRestore ? (
                        <button type="button" onClick={() => setRestore(r)} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50">
                          <ArchiveRestore className="size-3.5" /> Restore
                        </button>
                      ) : (
                        <span className="text-[11.5px] text-slate-400" title="You need delete rights on this kind of record to restore it">View only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="mt-3 flex justify-end gap-2 text-[12.5px]">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-40">
              Previous
            </button>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-40">
              Next
            </button>
          </div>
        )}
        <p className="mt-3 text-[12px] text-slate-400">
          Every delete and restore is also in the <Link to="/admin/audit" className="text-brand-700 hover:underline">audit log <ExternalLink className="inline size-3" /></Link>.
        </p>
      </div>
      <ConfirmDialog
        open={!!restore}
        title={`Restore ${restore?.typeLabel.toLowerCase() ?? ''} ${restore?.title ?? ''}?`}
        message="It comes back exactly as it was when deleted. If its code or number has been reused since, or it belongs to something that is still deleted, you will be told what to fix first."
        confirmLabel="Restore"
        onClose={() => setRestore(null)}
        onConfirm={doRestore}
      />
    </div>
  );
}
