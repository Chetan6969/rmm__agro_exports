import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { DataGrid, type Column, type DataGridHandle } from '../../components/DataGrid';
import { enterNavigation } from '../../components/EntityForm';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { useSession } from '../../lib/session';

export interface UserRow {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  defaultCompanyId: string | null;
  lastLoginAt: string | null;
  version: number;
  access: { companyId: string; roleIds: string[] }[];
}
export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  version: number;
}
interface Company {
  id: string;
  code: string;
  name: string;
}

export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') });
/** Every company the current user can see (super admin: all). */
export const useCompanies = () =>
  useQuery({
    queryKey: ['companies-lookup'],
    queryFn: () => api.get<{ id: string; label: string; sub?: string }[]>('/masters/companies/lookup?limit=100'),
    select: (rows): Company[] => rows.map((r) => ({ id: r.id, code: r.sub ?? r.label, name: r.label })),
  });

export function UsersPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const grid = useRef<DataGridHandle>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  const roles = useRoles();
  const companies = useCompanies();
  useEffect(() => grid.current?.focus(), []);
  useHotkeys({ 'alt+n, insert': () => can('admin.users', 'create') && navigate('/admin/users/new') }, [can]);

  const roleName = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r.name])), [roles.data]);
  const coCode = useMemo(() => new Map((companies.data ?? []).map((c) => [c.id, c.code])), [companies.data]);

  const columns: Column<UserRow>[] = [
    { key: 'fullName', label: 'Name', className: 'font-medium text-slate-900' },
    { key: 'username', label: 'Username', className: 'font-mono text-[12.5px]' },
    {
      key: 'access',
      label: 'Companies & roles',
      render: (u) =>
        u.isSuperAdmin ? (
          <Badge tone="amber">Super admin · all companies</Badge>
        ) : u.access.length ? (
          u.access.map((a) => `${coCode.get(a.companyId) ?? '?'}: ${a.roleIds.map((r) => roleName.get(r) ?? '?').join(', ')}`).join('  ·  ')
        ) : (
          <span className="text-slate-400">No access</span>
        ),
    },
    { key: 'isActive', label: 'Status', render: (u) => (u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>) },
    { key: 'lastLoginAt', label: 'Last login', render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—') },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Users"
        subtitle="Users are shared across the group; access is given per company through roles."
        actions={
          can('admin.users', 'create') && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} shortcut="alt+n" onClick={() => navigate('/admin/users/new')}>
              New user
            </Button>
          )
        }
      />
      {users.error && <div className="p-3"><ErrorBox error={users.error} /></div>}
      <DataGrid ref={grid} label="Users" columns={columns} rows={users.data ?? []} getId={(u) => u.id} loading={users.isFetching} onOpen={(u) => navigate(`/admin/users/${u.id}`)} />
    </div>
  );
}

export function UserFormPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { can, session } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const user = useQuery({ queryKey: ['users', id], queryFn: () => api.get<UserRow>(`/users/${id}`), enabled: !isNew });
  const roles = useRoles();
  const companies = useCompanies();

  const [f, setF] = useState({ username: '', fullName: '', email: '', phone: '', password: '', isActive: true, isSuperAdmin: false, defaultCompanyId: '' });
  const [access, setAccess] = useState<Record<string, Set<string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newPw, setNewPw] = useState('');

  useEffect(() => {
    const u = user.data;
    if (!u) return;
    setF({ username: u.username, fullName: u.fullName, email: u.email ?? '', phone: u.phone ?? '', password: '', isActive: u.isActive, isSuperAdmin: u.isSuperAdmin, defaultCompanyId: u.defaultCompanyId ?? '' });
    setAccess(Object.fromEntries(u.access.map((a) => [a.companyId, new Set(a.roleIds)])));
  }, [user.data]);
  useEffect(() => {
    setTimeout(() => root.current?.querySelector<HTMLElement>('[data-nav]')?.focus(), 0);
  }, [user.data]);

  const canEdit = isNew ? can('admin.users', 'create') : can('admin.users', 'edit');
  const back = () => navigate('/admin/users');

  const toggle = (companyId: string, roleId: string) =>
    setAccess((a) => {
      const s = new Set(a[companyId] ?? []);
      if (s.has(roleId)) s.delete(roleId);
      else s.add(roleId);
      return { ...a, [companyId]: s };
    });

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setErrors({});
    setErr(null);
    const accessList = Object.entries(access).map(([companyId, s]) => ({ companyId, roleIds: [...s] }));
    try {
      const common = {
        fullName: f.fullName,
        email: f.email || null,
        phone: f.phone || null,
        isActive: f.isActive,
        defaultCompanyId: f.defaultCompanyId || null,
        ...(session?.user.isSuperAdmin ? { isSuperAdmin: f.isSuperAdmin } : {}),
      };
      if (isNew) {
        await api.post('/users', { ...common, username: f.username, password: f.password, access: accessList });
      } else {
        await api.put(`/users/${id}`, { ...common, version: user.data!.version });
        await api.put(`/users/${id}/access`, { access: accessList });
      }
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User saved');
      back();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  useHotkeys({ 'mod+s, mod+enter': save, esc: back }, [f, access, saving, user.data], { inInputs: true });

  if (!isNew && user.isLoading) return <Spinner />;
  if (user.error) return <div className="p-6"><ErrorBox error={user.error} /></div>;

  const input = (name: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-slate-600">{label}</span>
      <input
        data-nav
        className="field-input"
        aria-invalid={errors[name] ? true : undefined}
        value={f[name] as string}
        onChange={(e) => setF((s) => ({ ...s, [name]: e.target.value }))}
        disabled={!canEdit}
        {...props}
      />
      {errors[name] && <span className="mt-0.5 block text-[12px] text-red-600">{errors[name]}</span>}
    </label>
  );

  const assignable = roles.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={root} data-form-root>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <button type="button" tabIndex={-1} onClick={back} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
            {isNew ? 'New user' : user.data?.fullName}
          </span>
        }
        actions={
          <>
            {!isNew && can('admin.users', 'edit') && <Button onClick={() => setResetOpen(true)}>Reset password</Button>}
            {!isNew && can('admin.users', 'delete') && user.data?.id !== session?.user.id && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            )}
            <Button onClick={back} shortcut="esc">
              Cancel
            </Button>
            {canEdit && (
              <Button variant="primary" data-nav-end icon={<Save className="size-3.5" />} loading={saving} onClick={save} shortcut="mod+s">
                Save
              </Button>
            )}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-5" onKeyDown={enterNavigation}>
        <div className="mx-auto max-w-4xl space-y-4">
          {err != null && <ErrorBox error={err} />}
          <Card className="grid gap-3 p-4 sm:grid-cols-2">
            {input('fullName', 'Full name *')}
            {input('username', 'Username *', { disabled: !isNew || !canEdit, autoComplete: 'off', className: 'field-input font-mono' })}
            {input('email', 'Email', { type: 'email' })}
            {input('phone', 'Phone')}
            {isNew && input('password', 'Initial password * (user must change it at first login)', { type: 'password', autoComplete: 'new-password' })}
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Default company at login</span>
              <select data-nav className="field-input" value={f.defaultCompanyId} disabled={!canEdit} onChange={(e) => setF((s) => ({ ...s, defaultCompanyId: e.target.value }))}>
                <option value="">— first available —</option>
                {(companies.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-5 sm:col-span-2">
              <label className="inline-flex items-center gap-2">
                <input data-nav type="checkbox" className="size-4 accent-brand-700" checked={f.isActive} disabled={!canEdit} onChange={(e) => setF((s) => ({ ...s, isActive: e.target.checked }))} />
                Active (can log in)
              </label>
              {session?.user.isSuperAdmin && (
                <label className="inline-flex items-center gap-2">
                  <input data-nav type="checkbox" className="size-4 accent-amber-600" checked={f.isSuperAdmin} onChange={(e) => setF((s) => ({ ...s, isSuperAdmin: e.target.checked }))} />
                  Super admin (all companies, all permissions)
                </label>
              )}
            </div>
          </Card>

          {!f.isSuperAdmin && (
            <Card>
              <div className="border-b border-slate-200 px-4 py-2.5">
                <h2 className="font-semibold text-slate-800">Access per company</h2>
                <p className="text-[12.5px] text-slate-500">Tick the roles this user has in each company. No roles = no access to that company. Space toggles a checkbox.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 text-[11.5px] text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Company</th>
                      {assignable.map((r) => (
                        <th key={r.id} className="px-3 py-2 text-center font-semibold whitespace-nowrap">
                          {r.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(companies.data ?? []).map((c) => (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-4 py-2">
                          <span className="font-mono text-[12px] text-slate-500">{c.code}</span> {c.name}
                        </td>
                        {assignable.map((r) => (
                          <td key={r.id} className="px-3 py-2 text-center">
                            <input
                              data-nav
                              type="checkbox"
                              aria-label={`${r.name} in ${c.name}`}
                              className="size-4 accent-brand-700"
                              checked={access[c.id]?.has(r.id) ?? false}
                              disabled={!canEdit}
                              onChange={() => toggle(c.id, r.id)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={resetOpen}
        title="Reset password"
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await api.post(`/users/${id}/reset-password`, { password: newPw });
                  toast.success('Password reset. The user must change it at next login.');
                  setResetOpen(false);
                  setNewPw('');
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Reset
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Temporary password (8+ chars, a letter and a number)</span>
          <input data-autofocus type="password" autoComplete="new-password" className="field-input" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </label>
        <p className="mt-2 text-[12.5px] text-slate-500">The user is signed out everywhere and asked to choose a new password.</p>
      </Modal>
      <ConfirmDialog
        open={deleteOpen}
        title="Delete user"
        message={<>Delete <b>{user.data?.fullName}</b>? They are signed out and lose all access. History is kept.</>}
        danger
        requireReason
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={async (reason) => {
          await api.del(`/users/${id}`, { reason });
          qc.invalidateQueries({ queryKey: ['users'] });
          toast.success('User deleted');
          back();
        }}
      />
    </div>
  );
}
