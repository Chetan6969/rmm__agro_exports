import { ACTIONS, MODULES, type ModuleDef } from '@rmm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/Modal';
import { Badge, Button, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { showError } from '../../lib/notify';
import { useHotkeys } from '../../lib/hotkeys';
import { useSession } from '../../lib/session';
import { useRoles, type RoleRow } from './UsersPage';

const groups = [...new Set(MODULES.map((m) => m.group))];

/**
 * Roles + permission matrix.
 * Matrix keys: arrows move between cells · Space toggles · A toggles the whole row · Ctrl+S saves.
 */
export function RolesPage() {
  const { can, session } = useSession();
  const qc = useQueryClient();
  const roles = useRoles();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const role: RoleRow | undefined = roles.data?.find((r) => r.id === selected);
  useEffect(() => {
    if (selected === null && roles.data?.length) setSelected(roles.data[0].id);
  }, [roles.data, selected]);
  useEffect(() => {
    if (selected === 'new') {
      setName('');
      setDescription('');
      setPerms(new Set());
    } else if (role) {
      setName(role.name);
      setDescription(role.description ?? '');
      setPerms(new Set(role.permissions));
    }
    setDirty(false);
  }, [selected, role]);

  const readOnly = role?.isSystem || (selected === 'new' ? !can('admin.roles', 'create') : !can('admin.roles', 'edit'));
  // a sub-admin can only grant permissions they hold
  const grantable = (p: string) => session?.user.isSuperAdmin || session?.permissions.includes(p);

  const toggle = (p: string) => {
    if (readOnly || !grantable(p)) return;
    setPerms((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
    setDirty(true);
  };
  const toggleRow = (m: ModuleDef) => {
    if (readOnly) return;
    const keys = m.actions.map((a) => `${m.key}:${a}`).filter(grantable);
    const allOn = keys.every((k) => perms.has(k));
    setPerms((s) => {
      const n = new Set(s);
      for (const k of keys) {
        if (allOn) n.delete(k);
        else n.add(k);
      }
      return n;
    });
    setDirty(true);
  };

  const save = async () => {
    if (readOnly || saving) return;
    setSaving(true);
    try {
      const body = { name, description: description || null, permissions: [...perms] };
      const saved =
        selected === 'new'
          ? await api.post<RoleRow>('/roles', body)
          : await api.put<RoleRow>(`/roles/${selected}`, { ...body, version: role!.version });
      await qc.invalidateQueries({ queryKey: ['roles'] });
      await qc.invalidateQueries({ queryKey: ['session'] });
      setSelected(saved.id);
      setDirty(false);
      toast.success(`Role "${saved.name}" saved`);
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  useHotkeys(
    {
      'mod+s': save,
      'alt+n': () => can('admin.roles', 'create') && setSelected('new'),
    },
    [name, description, perms, selected, saving, role],
    { inInputs: true },
  );

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of perms) {
      const mod = p.slice(0, p.lastIndexOf(':'));
      const g = MODULES.find((m) => m.key === mod)?.group ?? '';
      out[g] = (out[g] ?? 0) + 1;
    }
    return out;
  }, [perms]);

  const onMatrixKey = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const t = e.target as HTMLElement;
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    if (Number.isNaN(r)) return;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      for (let step = 1; step < 60; step++) {
        const el = e.currentTarget.querySelector<HTMLElement>(`[data-r="${r + dr * step}"][data-c="${c + dc * step}"]`);
        if (el) return el.focus();
        if (dc && (c + dc * step < 0 || c + dc * step >= ACTIONS.length)) return;
      }
    };
    if (e.key === 'ArrowDown') move(1, 0);
    else if (e.key === 'ArrowUp') move(-1, 0);
    else if (e.key === 'ArrowRight') move(0, 1);
    else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const m = MODULES[r];
      if (m) toggleRow(m);
    }
  };

  if (roles.isLoading) return <Spinner />;

  let rowIndex = -1;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Roles & permissions"
        subtitle="Roles are defined once and assigned to users per company (Users screen)."
        actions={
          can('admin.roles', 'create') && (
            <Button icon={<Plus className="size-3.5" />} shortcut="alt+n" onClick={() => setSelected('new')}>
              New role
            </Button>
          )
        }
      />
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav
          className="shrink-0 overflow-y-auto border-slate-200 bg-white max-md:max-h-44 max-md:border-b md:w-60 md:border-r"
          aria-label="Roles"
        >
          <ul
            role="listbox"
            tabIndex={0}
            aria-label="Roles"
            className="p-1.5"
            onKeyDown={(e) => {
              const list = roles.data ?? [];
              const i = list.findIndex((r) => r.id === selected);
              if (e.key === 'ArrowDown' && i < list.length - 1) setSelected(list[i + 1].id);
              else if (e.key === 'ArrowUp' && i > 0) setSelected(list[i - 1].id);
              else return;
              e.preventDefault();
            }}
          >
            {(roles.data ?? []).map((r) => (
              <li
                key={r.id}
                role="option"
                aria-selected={r.id === selected}
                onClick={() => setSelected(r.id)}
                className={`cursor-pointer rounded px-2.5 py-1.5 ${r.id === selected ? 'bg-brand-700 text-white' : 'hover:bg-slate-100'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  {r.isSystem && <span className="text-[10.5px] opacity-75">system</span>}
                </div>
                <div className={`text-[11.5px] ${r.id === selected ? 'text-white/75' : 'text-slate-400'}`}>
                  {r.isSystem ? 'all permissions' : `${r.permissions.length} permissions`} · {r.userCount} user{r.userCount === 1 ? '' : 's'}
                </div>
              </li>
            ))}
            {selected === 'new' && <li className="rounded bg-brand-700 px-2.5 py-1.5 font-medium text-white">New role…</li>}
          </ul>
        </nav>

        {selected && (selected === 'new' || role) ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
              <label className="block w-full sm:w-60">
                <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Role name</span>
                <input
                  className="field-input"
                  value={name}
                  disabled={readOnly}
                  autoFocus={selected === 'new'}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label className="block w-full flex-1 sm:min-w-60">
                <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Description</span>
                <input
                  className="field-input"
                  value={description}
                  disabled={readOnly}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <div className="flex gap-2">
                {role && !role.isSystem && can('admin.roles', 'delete') && (
                  <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                )}
                {!readOnly && (
                  <Button variant="primary" icon={<Save className="size-3.5" />} loading={saving} disabled={!dirty || !name.trim()} onClick={save} shortcut="mod+s">
                    Save
                  </Button>
                )}
              </div>
            </div>
            {role?.isSystem && (
              <div className="px-5 pt-3">
                <ErrorBox error={new Error('Administrator is a system role: it always has every permission, including modules added later.')} />
              </div>
            )}
            <div className="flex-1 overflow-auto p-3 sm:p-5">
              <table className="w-full min-w-[600px] max-w-4xl border-separate border-spacing-0 rounded-md border border-slate-200 bg-white" onKeyDown={onMatrixKey}>
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-[11.5px] font-semibold text-slate-500 uppercase">Module</th>
                    {ACTIONS.map((a) => (
                      <th key={a} className="border-b border-slate-200 px-2 py-2 text-center text-[11.5px] font-semibold text-slate-500 capitalize">
                        {a}
                      </th>
                    ))}
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g}>
                    <tr>
                      <td colSpan={ACTIONS.length + 1} className="border-b border-slate-200 bg-slate-50/60 px-3 py-1.5 text-[11.5px] font-semibold tracking-wide text-slate-600 uppercase">
                        {g} {counts[g] ? <Badge tone="green">{counts[g]}</Badge> : null}
                      </td>
                    </tr>
                    {MODULES.filter((m) => m.group === g).map((m) => {
                      rowIndex = MODULES.indexOf(m);
                      const r = rowIndex;
                      return (
                        <tr key={m.key} className="hover:bg-slate-50">
                          <td className="border-b border-slate-100 px-3 py-1">
                            <button type="button" tabIndex={-1} className="text-left hover:underline" onClick={() => toggleRow(m)} title="Toggle all (A)">
                              {m.label}
                            </button>
                          </td>
                          {ACTIONS.map((a, c) => {
                            const p = `${m.key}:${a}`;
                            const applicable = m.actions.includes(a);
                            return (
                              <td key={a} className="border-b border-slate-100 px-2 py-1 text-center">
                                {applicable ? (
                                  <input
                                    type="checkbox"
                                    data-r={r}
                                    data-c={c}
                                    aria-label={`${m.label}: ${a}`}
                                    className="size-4 accent-brand-700 disabled:opacity-40"
                                    checked={role?.isSystem || perms.has(p)}
                                    disabled={readOnly || !grantable(p)}
                                    onChange={() => toggle(p)}
                                  />
                                ) : (
                                  <span className="text-slate-200">·</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
              <p className="mt-2 text-[12px] text-slate-500">Arrows move · Space toggles · A toggles the whole row · Ctrl+S saves</p>
            </div>
          </div>
        ) : (
          <div className="p-6 text-slate-500">Select a role</div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete role"
        message={<>Delete role <b>{role?.name}</b>? Roles still assigned to users cannot be deleted.</>}
        danger
        confirmLabel="Delete"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.del(`/roles/${selected}`);
          await qc.invalidateQueries({ queryKey: ['roles'] });
          setSelected(null);
          toast.success('Role deleted');
        }}
      />
    </div>
  );
}
