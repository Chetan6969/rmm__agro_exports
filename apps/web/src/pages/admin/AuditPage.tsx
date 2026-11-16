import { DOC_LIST, ENTITIES, getDoc } from '@rmm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DataGrid, type Column, type DataGridHandle } from '../../components/DataGrid';
import { Modal } from '../../components/Modal';
import { Badge, Button, ErrorBox, PageHeader } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useSession } from '../../lib/session';

interface Log {
  id: number;
  at: string;
  userId: string | null;
  username: string | null;
  fullName: string | null;
  companyId: string | null;
  entity: string;
  recordId: string | null;
  action: string;
  changes: Record<string, [unknown, unknown]> | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
}

const tone = (a: string) => (a === 'create' ? 'green' : a === 'delete' || a === 'login_failed' ? 'red' : a === 'update' ? 'amber' : 'slate') as 'green' | 'red' | 'amber' | 'slate';
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Log | null>(null);
  const grid = useRef<DataGridHandle>(null);
  const filters = {
    entity: params.get('entity') ?? '',
    recordId: params.get('recordId') ?? '',
    action: params.get('action') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    scope: params.get('scope') ?? 'company',
  };
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
    setPage(1);
  };
  useEffect(() => grid.current?.focus(), []);

  const q = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () => api.get<{ rows: Log[]; hasMore: boolean }>(`/audit${qs({ ...filters, page })}`),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Log>[] = [
    { key: 'at', label: 'When', render: (l) => new Date(l.at).toLocaleString() },
    { key: 'user', label: 'User', render: (l) => l.fullName ?? l.username ?? '—' },
    { key: 'action', label: 'Action', render: (l) => <Badge tone={tone(l.action)}>{l.action.replace('_', ' ')}</Badge> },
    { key: 'entity', label: 'What', render: (l) => ENTITIES[l.entity]?.label ?? getDoc(l.entity)?.label ?? l.entity.replace('_', ' ') },
    {
      key: 'changes',
      label: 'Changes',
      render: (l) =>
        l.changes
          ? Object.entries(l.changes)
              .slice(0, 3)
              .map(([k, [a, b]]) => `${k}: ${show(a)} → ${show(b)}`)
              .join(' · ') + (Object.keys(l.changes).length > 3 ? ' …' : '')
          : l.meta
            ? Object.entries(l.meta)
                .map(([k, v]) => `${k}: ${show(v)}`)
                .join(' · ')
            : '',
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Audit log" subtitle="Every change, login and export. Entries cannot be edited or deleted." />
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-5">
        <label className="block">
          <span className="block text-[11.5px] text-slate-500">Master / area</span>
          <select className="field-input" value={filters.entity} onChange={(e) => set('entity', e.target.value)}>
            <option value="">All</option>
            {[...DOC_LIST.map((d) => [d.key, d.plural]), ...Object.values(ENTITIES).map((e) => [e.key, e.plural]), ['users', 'Users'], ['roles', 'Roles'], ['auth', 'Logins'], ['sharing_policies', 'Sharing'], ['number_series', 'Numbering']].map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11.5px] text-slate-500">Action</span>
          <select className="field-input" value={filters.action} onChange={(e) => set('action', e.target.value)}>
            <option value="">All</option>
            {['create', 'update', 'delete', 'export', 'login', 'login_failed', 'logout', 'switch_company', 'access_change', 'reset_password'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11.5px] text-slate-500">From</span>
          <input type="date" className="field-input" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-[11.5px] text-slate-500">To</span>
          <input type="date" className="field-input" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </label>
        {session?.user.isSuperAdmin && (
          <label className="inline-flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" className="accent-brand-700" checked={filters.scope === 'all'} onChange={(e) => set('scope', e.target.checked ? 'all' : '')} />
            All companies + logins
          </label>
        )}
        {filters.recordId && (
          <Button variant="ghost" onClick={() => set('recordId', '')}>
            Clear record filter ×
          </Button>
        )}
        <div className="ml-auto flex gap-1 pb-0.5">
          <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <Button disabled={!q.data?.hasMore} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      </div>
      {q.error && <div className="p-3"><ErrorBox error={q.error} /></div>}
      <DataGrid
        ref={grid}
        label="Audit log"
        columns={columns}
        rows={q.data?.rows ?? []}
        getId={(l) => String(l.id)}
        loading={q.isFetching}
        onOpen={setDetail}
        onPage={(d) => setPage((p) => (d === 1 ? (q.data?.hasMore ? p + 1 : p) : Math.max(1, p - 1)))}
        empty="No entries"
      />
      <Modal open={!!detail} title="Audit entry" onClose={() => setDetail(null)} width="max-w-2xl">
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
              <div>
                <span className="text-slate-500">When:</span> {new Date(detail.at).toLocaleString()}
              </div>
              <div>
                <span className="text-slate-500">User:</span> {detail.fullName ?? '—'} ({detail.username ?? '—'})
              </div>
              <div>
                <span className="text-slate-500">Action:</span> {detail.action}
              </div>
              <div>
                <span className="text-slate-500">IP:</span> {detail.ip ?? '—'}
              </div>
            </div>
            {detail.changes && (
              <table className="w-full text-[12.5px]">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Field</th>
                    <th className="px-2 py-1">Before</th>
                    <th className="px-2 py-1">After</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(detail.changes).map(([k, [a, b]]) => (
                    <tr key={k} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1 font-medium">{k}</td>
                      <td className="px-2 py-1 break-all text-red-700">{show(a)}</td>
                      <td className="px-2 py-1 break-all text-brand-700">{show(b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {detail.meta && <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-[12px]">{JSON.stringify(detail.meta, null, 2)}</pre>}
          </div>
        )}
      </Modal>
    </div>
  );
}
