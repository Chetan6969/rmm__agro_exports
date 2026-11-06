import { getEntity, type EntityDef, type ListResult } from '@rmm/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { DataGrid, type Column, type DataGridHandle } from '../components/DataGrid';
import { ConfirmDialog } from '../components/Modal';
import { Badge, Button, ErrorBox, PageHeader } from '../components/ui';
import { api, qs } from '../lib/api';
import { useHotkeys } from '../lib/hotkeys';
import { useSession } from '../lib/session';

type Row = Record<string, unknown> & { id: string };

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function cellValue(def: EntityDef, name: string, r: Row) {
  const f = def.fields.find((x) => x.name === name)!;
  const v = r[name];
  if (f.type === 'boolean') return v ? <span className="text-brand-700">✓</span> : <span className="text-slate-300">—</span>;
  if (f.type === 'ref') return (r[`${name}Label`] as string) ?? '';
  if (v === null || v === undefined) return '';
  if (f.type === 'decimal') return String(Number(v));
  return String(v);
}

export function MasterListPage() {
  const { entity = '' } = useParams();
  const def = getEntity(entity);
  if (!def) return <ErrorBox error={new Error(`Unknown master: ${entity}`)} />;
  return <MasterList key={def.key} def={def} />;
}

function MasterList({ def }: { def: EntityDef }) {
  const { can, session } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [ownership, setOwnership] = useState<'all' | 'own' | 'shared'>('all');
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const debounced = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const grid = useRef<DataGridHandle>(null);
  const mod = `master.${def.key}`;
  const company = def.scope === 'company';

  useEffect(() => setPage(1), [debounced, ownership]);
  useEffect(() => {
    setParams(debounced ? { q: debounced } : {}, { replace: true });
  }, [debounced, setParams]);
  useEffect(() => grid.current?.focus(), []);

  const listParams = { search: debounced, page, pageSize: 50, ownership: company ? ownership : undefined };
  const q = useQuery({
    queryKey: ['masters', def.key, listParams],
    queryFn: () => api.get<ListResult<Row>>(`/masters/${def.key}${qs(listParams)}`),
    placeholderData: keepPreviousData,
    enabled: !company || !!session?.activeCompany,
  });
  const rows = q.data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));

  const columns = useMemo<Column<Row>[]>(() => {
    const cols: Column<Row>[] = def.fields
      .filter((f) => f.list)
      .map((f) => ({
        key: f.name,
        label: f.label,
        align: f.type === 'decimal' || f.type === 'integer' ? 'right' : f.type === 'boolean' ? 'center' : 'left',
        className: f.name === 'code' ? 'font-mono text-[12.5px]' : f.name === def.displayField ? 'font-medium text-slate-900' : '',
        render: (r) => cellValue(def, f.name, r),
      }));
    if (company) {
      cols.push({
        key: '_owner',
        label: 'Owner',
        render: (r) => (r._shared ? <Badge tone="blue">Shared · {r._ownerCode as string}</Badge> : <Badge tone="green">Own</Badge>),
      });
    }
    return cols;
  }, [def, company]);

  const open = (r: Row) => navigate(`/m/${def.key}/${r.id}`);
  const canCreate = can(mod, 'create') && (def.scope !== 'group' || session?.user.isSuperAdmin);
  const exportCsv = () => {
    if (!can(mod, 'export')) return toast.error('You do not have export permission for this master');
    const a = document.createElement('a');
    a.href = `/api/masters/${def.key}/export${qs({ search: debounced, ownership: company ? ownership : undefined })}`;
    a.click();
  };

  useHotkeys(
    {
      '/, mod+f': () => {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
      'alt+n, insert': () => canCreate && navigate(`/m/${def.key}/new`),
      'alt+e': exportCsv,
      'alt+1': () => company && setOwnership('all'),
      'alt+2': () => company && setOwnership('own'),
      'alt+3': () => company && setOwnership('shared'),
    },
    [canCreate, debounced, ownership],
  );

  if (company && !session?.activeCompany) {
    return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={def.plural}
        subtitle={
          def.scope === 'global'
            ? 'Common to all companies'
            : def.scope === 'group'
              ? 'Your group companies'
              : `${session?.activeCompany?.name}${def.shareable ? ' · includes records shared with this company' : ''}`
        }
        actions={
          <>
            {can(mod, 'export') && (
              <Button icon={<Download className="size-3.5" />} shortcut="alt+e" onClick={exportCsv}>
                Export
              </Button>
            )}
            {canCreate && (
              <Button variant="primary" icon={<Plus className="size-3.5" />} shortcut="alt+n" onClick={() => navigate(`/m/${def.key}/new`)}>
                New
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5 py-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="field-input pl-7"
            placeholder="Search…  ( / )"
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
        {company && def.shareable && (
          <div className="flex rounded border border-slate-300 bg-white text-[12.5px]" role="radiogroup" aria-label="Ownership">
            {(['all', 'own', 'shared'] as const).map((o, i) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={ownership === o}
                onClick={() => setOwnership(o)}
                className={`px-2.5 py-1 capitalize ${ownership === o ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'} ${i ? 'border-l border-slate-300' : ''}`}
                title={`Alt+${i + 1}`}
              >
                {o}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto text-[12.5px] text-slate-500">
          {q.data ? `${q.data.total} record${q.data.total === 1 ? '' : 's'}` : ''}
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
        onDelete={(r) => (can(mod, 'delete') ? setToDelete(r) : toast.error('You do not have delete permission'))}
        onPage={(d) => setPage((p) => Math.min(Math.max(p + d, 1), pages))}
        empty={
          debounced ? (
            'No matches'
          ) : canCreate ? (
            <span>
              No {def.plural.toLowerCase()} yet. Press <kbd className="kbd">Alt+N</kbd> to add one.
            </span>
          ) : (
            'No records'
          )
        }
      />
      <div className="flex items-center gap-4 border-t border-slate-200 bg-slate-50 px-5 py-1.5 text-[11.5px] text-slate-500">
        <span>↑↓ move · Enter open · Del delete · PgUp/PgDn page · / search · F1 help</span>
      </div>
      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${def.label.toLowerCase()}`}
        message={
          <>
            Delete <b>{toDelete ? String(toDelete[def.displayField] ?? '') : ''}</b>? It will be hidden everywhere but kept in the audit history.
          </>
        }
        confirmLabel="Delete"
        danger
        requireReason
        onClose={() => {
          setToDelete(null);
          setTimeout(() => grid.current?.focus(), 0);
        }}
        onConfirm={async (reason) => {
          await api.del(`/masters/${def.key}/${toDelete!.id}`, { reason });
          toast.success('Deleted');
          qc.invalidateQueries({ queryKey: ['masters', def.key] });
          qc.invalidateQueries({ queryKey: ['lookup', def.key] });
        }}
      />
    </div>
  );
}
