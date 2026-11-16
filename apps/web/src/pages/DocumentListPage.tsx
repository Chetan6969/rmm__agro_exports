import { childDocs, documentValue, formatAmount, getDoc, statusLabel, type DocDef, type ListResult } from '@rmm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { DataGrid, type Column, type DataGridHandle } from '../components/DataGrid';
import { Badge, Button, ErrorBox, PageHeader } from '../components/ui';
import { api, qs } from '../lib/api';
import { useHotkeys } from '../lib/hotkeys';
import { showProblem } from '../lib/notify';
import { useSession } from '../lib/session';
import { useDebounced } from './MasterListPage';

type Row = Record<string, unknown> & { id: string };

export const STATUS_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  DRAFT: 'slate',
  CONFIRMED: 'blue',
  FULFILLED: 'green',
  OPEN: 'blue',
  IN_PRODUCTION: 'amber',
  COMPLETED: 'green',
  ISSUED: 'blue',
  NEGOTIATED: 'amber',
  PAID: 'green',
  CANCELLED: 'red',
};

export function DocumentListPage() {
  const { doc = '' } = useParams();
  const def = getDoc(doc);
  if (!def) return <div className="p-6"><ErrorBox error={new Error(`Unknown document type: ${doc}`)} /></div>;
  return <DocumentList key={def.key} def={def} />;
}

function DocumentList({ def }: { def: DocDef }) {
  const { can, session } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const grid = useRef<DataGridHandle>(null);
  const children = childDocs(def.key);

  useEffect(() => setPage(1), [debounced, status]);
  useEffect(() => {
    const p: Record<string, string> = {};
    if (debounced) p.q = debounced;
    if (status) p.status = status;
    setParams(p, { replace: true });
  }, [debounced, status, setParams]);
  useEffect(() => grid.current?.focus(), []);

  const listParams = { search: debounced, status: status || undefined, page, pageSize: 50 };
  const q = useQuery({
    queryKey: ['documents', def.key, listParams],
    queryFn: () => api.get<ListResult<Row>>(`/documents/${def.key}${qs(listParams)}`),
    placeholderData: keepPreviousData,
    enabled: !!session?.activeCompany,
  });
  const rows = q.data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));

  const columns = useMemo<Column<Row>[]>(() => {
    const cols: Column<Row>[] = [
      { key: 'documentNumber', label: 'Number', className: 'font-mono text-[12.5px] font-medium text-slate-900', render: (r) => String(r.documentNumber) },
      { key: 'documentDate', label: 'Date', render: (r) => String(r.documentDate) },
      { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[String(r.status)] ?? 'slate'}>{statusLabel(String(r.status))}</Badge> },
      { key: 'buyer', label: 'Buyer', className: 'max-w-56 truncate', render: (r) => String(r.buyerIdLabel ?? '') },
    ];
    if (def.parent) {
      const f = def.header.find((x) => x.name === def.parent!.field)!;
      cols.push({ key: 'parent', label: f.label.replace(/^Generated against /i, 'Against '), className: 'font-mono text-[12px]', render: (r) => String(r[`${f.name}Label`] ?? '') });
    }
    cols.push(
      { key: 'pod', label: 'Port of discharge', render: (r) => String(r.portOfDischargeIdLabel ?? '') },
      { key: 'qty', label: 'Qty (MT)', align: 'right', className: 'tabular-nums', render: (r) => formatAmount(String(r.totalQuantityMt ?? 0), 3) },
      {
        key: 'value',
        label: 'Value',
        align: 'right',
        className: 'tabular-nums',
        render: (r) => `${r.currencyIdLabel ?? ''} ${formatAmount(documentValue(def, r))}`.trim(),
      },
    );
    if (children.length) {
      cols.push({
        key: 'remaining',
        label: `Left for ${children[0].plural.toLowerCase()}`,
        align: 'right',
        className: 'tabular-nums',
        render: (r) =>
          r._remainingMt === undefined ? '' : <span className={Number(r._remainingMt) > 0 ? 'text-amber-700' : 'text-slate-400'}>{formatAmount(String(r._remainingMt), 3)}</span>,
      });
    }
    return cols;
  }, [def, children]);

  const canCreate = can(def.module, 'create');
  const open = (r: Row) => navigate(`/d/${def.key}/${r.id}`);
  const exportCsv = () => {
    if (!can(def.module, 'export')) return showProblem(`You do not have export permission for ${def.plural}`, `Ask an administrator to tick "export" for ${def.plural} in your role.`);
    const a = document.createElement('a');
    a.href = `/api/documents/${def.key}/export${qs({ search: debounced, status: status || undefined })}`;
    a.click();
  };

  useHotkeys(
    {
      '/, mod+f': () => {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
      'alt+n, insert': () => canCreate && navigate(`/d/${def.key}/new`),
      'alt+e': exportCsv,
    },
    [canCreate, debounced, status],
  );

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={def.plural}
        subtitle={session.activeCompany.name}
        actions={
          <>
            {can(def.module, 'export') && (
              <Button icon={<Download className="size-3.5" />} shortcut="alt+e" onClick={exportCsv}>
                Export
              </Button>
            )}
            {canCreate && (
              <Button variant="primary" icon={<Plus className="size-3.5" />} shortcut="alt+n" onClick={() => navigate(`/d/${def.key}/new`)}>
                New
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="field-input pl-7"
            placeholder="Number, buyer, PO, LC…  ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                grid.current?.focus();
              } else if (e.key === 'Escape') {
                if (search) setSearch('');
                else grid.current?.focus();
              }
            }}
          />
        </div>
        <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {def.statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <div className="ml-auto text-[12.5px] text-slate-500">
          {q.data ? `${q.data.total} document${q.data.total === 1 ? '' : 's'}` : ''}
          {pages > 1 && ` · page ${page} of ${pages}`}
        </div>
      </div>
      {q.error && (
        <div className="p-3">
          <ErrorBox error={q.error} />
        </div>
      )}
      <DataGrid
        ref={grid}
        label={def.plural}
        columns={columns}
        rows={rows}
        getId={(r) => r.id}
        loading={q.isFetching}
        onOpen={open}
        onExitTop={() => searchRef.current?.focus()}
        onPage={(d) => setPage((p) => Math.min(Math.max(p + d, 1), pages))}
        empty={
          debounced || status ? (
            'No matches'
          ) : canCreate ? (
            <span>
              No {def.plural.toLowerCase()} yet. Press <kbd className="kbd">Alt+N</kbd> to create one.
            </span>
          ) : (
            'No documents'
          )
        }
      />
    </div>
  );
}
