import { ENTITIES, type ListResult, type SharingPolicy } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DataGrid, type Column, type DataGridHandle } from '../../components/DataGrid';
import { enterNavigation } from '../../components/EntityForm';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, Button, ErrorBox, PageHeader } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { showError, showProblem } from '../../lib/notify';
import { useHotkeys } from '../../lib/hotkeys';
import { useSession } from '../../lib/session';

type Policy = SharingPolicy & { sourceCode: string; targetCode: string };
const shareable = Object.values(ENTITIES).filter((e) => e.shareable);

export function SharingPage() {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const grid = useRef<DataGridHandle>(null);
  const [editing, setEditing] = useState<Policy | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Policy | null>(null);
  const list = useQuery({ queryKey: ['sharing'], queryFn: () => api.get<Policy[]>('/sharing'), enabled: !!session?.activeCompany });
  useEffect(() => grid.current?.focus(), []);
  useHotkeys({ 'alt+n, insert': () => can('admin.sharing', 'create') && setEditing('new') }, [can]);

  const mine = (p: Policy) => p.sourceCompanyId === session?.activeCompany?.id || session?.user.isSuperAdmin;
  const columns: Column<Policy>[] = [
    { key: 'entity', label: 'Master', className: 'font-medium text-slate-900', render: (p) => ENTITIES[p.entity]?.plural ?? p.entity },
    { key: 'from', label: 'From', render: (p) => <span className="font-mono">{p.sourceCode}</span> },
    { key: 'to', label: 'Shared with', render: (p) => <span className="font-mono">{p.targetCode}</span> },
    { key: 'access', label: 'Access', render: (p) => (p.access === 'write' ? <Badge tone="amber">Read + edit</Badge> : <Badge tone="blue">Read only</Badge>) },
    { key: 'scope', label: 'Records', render: (p) => (p.recordIds ? `${p.recordIds.length} selected` : 'All records') },
    { key: 'note', label: 'Note', render: (p) => p.note ?? '' },
  ];

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Data sharing"
        subtitle={`By default every company's data is private. Here ${session.activeCompany.code} can share chosen masters with other companies.`}
        actions={
          can('admin.sharing', 'create') && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} shortcut="alt+n" onClick={() => setEditing('new')}>
              Share a master
            </Button>
          )
        }
      />
      {list.error && <div className="p-3"><ErrorBox error={list.error} /></div>}
      <DataGrid
        ref={grid}
        label="Sharing policies"
        columns={columns}
        rows={list.data ?? []}
        getId={(p) => p.id}
        loading={list.isFetching}
        onOpen={(p) => (mine(p) && can('admin.sharing', 'edit') ? setEditing(p) : toast.info('Only the owning company can change this policy'))}
        onDelete={(p) => (mine(p) && can('admin.sharing', 'delete') ? setToDelete(p) : showProblem('Only the owning company can remove this policy', 'Switch to the company that shares the data (Alt+C) to remove it.'))}
        empty="Nothing is shared. Each company sees only its own data."
      />
      <div className="border-t border-slate-200 bg-slate-50 px-5 py-1.5 text-[11.5px] text-slate-500 max-sm:hidden">Enter edit · Del remove · Alt+N new</div>
      {editing && (
        <PolicyDialog
          policy={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
            setTimeout(() => grid.current?.focus(), 0);
          }}
          onSaved={() => qc.invalidateQueries({ queryKey: ['sharing'] })}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Stop sharing"
        message={
          <>
            Stop sharing <b>{toDelete && ENTITIES[toDelete.entity]?.plural}</b> with <b>{toDelete?.targetCode}</b>? They lose access immediately.
          </>
        }
        danger
        confirmLabel="Stop sharing"
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await api.del(`/sharing/${toDelete!.id}`);
          qc.invalidateQueries({ queryKey: ['sharing'] });
          toast.success('Sharing removed');
        }}
      />
    </div>
  );
}

function PolicyDialog({ policy, onClose, onSaved }: { policy: Policy | null; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession();
  const [entity, setEntity] = useState(policy?.entity ?? shareable[0].key);
  const [target, setTarget] = useState(policy?.targetCompanyId ?? '');
  const [access, setAccess] = useState<'read' | 'write'>(policy?.access ?? 'read');
  const [scope, setScope] = useState<'all' | 'some'>(policy?.recordIds ? 'some' : 'all');
  const [ids, setIds] = useState<Set<string>>(new Set(policy?.recordIds ?? []));
  const [note, setNote] = useState(policy?.note ?? '');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const companies = useQuery({ queryKey: ['sharing-companies'], queryFn: () => api.get<{ id: string; code: string; name: string }[]>('/sharing/companies') });
  const records = useQuery({
    queryKey: ['masters', entity, 'own-all'],
    queryFn: () => api.get<ListResult<Record<string, unknown> & { id: string }>>(`/masters/${entity}${qs({ ownership: 'own', pageSize: 500 })}`),
    enabled: scope === 'some',
  });
  const def = ENTITIES[entity];
  const shown = useMemo(
    () => (records.data?.rows ?? []).filter((r) => !filter || String(r[def.displayField] ?? '').toLowerCase().includes(filter.toLowerCase())),
    [records.data, filter, def],
  );

  const save = async () => {
    setBusy(true);
    try {
      const body = { access, recordIds: scope === 'all' ? null : [...ids], note: note || null };
      if (scope === 'some' && !ids.size) throw new Error('Select at least one record, or choose "All records"');
      if (policy) await api.put(`/sharing/${policy.id}`, body);
      else {
        if (!target) throw new Error('Choose the company to share with');
        await api.post('/sharing', { ...body, entity, targetCompanyId: target });
      }
      onSaved();
      toast.success('Sharing saved');
      onClose();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  useHotkeys({ 'mod+s, mod+enter': save }, [entity, target, access, scope, ids, note], { inInputs: true, inModal: true });

  return (
    <Modal
      open
      title={policy ? 'Edit sharing' : 'Share a master'}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose} shortcut="esc">
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} shortcut="mod+s" data-nav-end>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3" onKeyDown={enterNavigation}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Master</span>
            <select data-nav data-autofocus className="field-input" value={entity} disabled={!!policy} onChange={(e) => (setEntity(e.target.value), setIds(new Set()))}>
              {shareable.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.plural}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">From {session?.activeCompany?.code} to</span>
            <select data-nav className="field-input" value={target} disabled={!!policy} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— choose company —</option>
              {(companies.data ?? [])
                .filter((c) => c.id !== session?.activeCompany?.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Access</span>
            <select data-nav className="field-input" value={access} onChange={(e) => setAccess(e.target.value as 'read' | 'write')}>
              <option value="read">Read only</option>
              <option value="write">Read + edit (never delete)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Records</span>
            <select data-nav className="field-input" value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'some')}>
              <option value="all">All records (including future ones)</option>
              <option value="some">Only selected records</option>
            </select>
          </label>
        </div>
        {scope === 'some' && (
          <div className="rounded border border-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-200 p-2">
              <input className="field-input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <span className="shrink-0 text-[12px] text-slate-500">{ids.size} selected</span>
            </div>
            <ul className="max-h-56 overflow-y-auto p-1">
              {records.isLoading && <li className="p-2 text-slate-400">Loading…</li>}
              {shown.map((r) => (
                <li key={r.id}>
                  <label className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-700"
                      checked={ids.has(r.id)}
                      onChange={() =>
                        setIds((s) => {
                          const n = new Set(s);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        })
                      }
                    />
                    {String(r[def.displayField] ?? '')}
                    {r.code ? <span className="ml-auto font-mono text-[11.5px] text-slate-400">{String(r.code)}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Note</span>
          <input data-nav className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this shared?" />
        </label>
      </div>
    </Modal>
  );
}
