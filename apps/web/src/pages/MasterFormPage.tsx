import { getEntity, type EntityDef } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { EntityForm, type Values } from '../components/EntityForm';
import { ConfirmDialog } from '../components/Modal';
import { Badge, Button, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { useHotkeys } from '../lib/hotkeys';
import { useSession } from '../lib/session';

type Rec = Values & { id: string; version: number; _shared?: boolean; _ownerCode?: string };

export function MasterFormPage() {
  const { entity = '', id = 'new' } = useParams();
  const def = getEntity(entity);
  if (!def) return <ErrorBox error={new Error(`Unknown master: ${entity}`)} />;
  return <MasterForm key={`${def.key}-${id}`} def={def} id={id} />;
}

function MasterForm({ def, id }: { def: EntityDef; id: string }) {
  const isNew = id === 'new';
  const { can, session } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mod = `master.${def.key}`;
  const root = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState<Values>({});
  const [labels, setLabels] = useState<Record<string, string | null | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const record = useQuery({
    queryKey: ['masters', def.key, 'one', id],
    queryFn: () => api.get<Rec>(`/masters/${def.key}/${id}`),
    enabled: !isNew,
  });
  const defaults = useQuery({
    queryKey: ['defaults', def.key],
    queryFn: () => api.get<{ values: Values }>(`/defaults/${def.key}`),
    enabled: isNew,
  });

  useEffect(() => {
    if (loaded) return;
    const src = isNew ? defaults.data?.values : record.data;
    if (!src) return;
    const v: Values = {};
    const l: Record<string, string> = {};
    for (const f of def.fields) {
      v[f.name] = src[f.name] ?? (f.type === 'boolean' ? false : null);
      if (f.type === 'ref' && src[`${f.name}Label`]) l[f.name] = src[`${f.name}Label`] as string;
    }
    setValues(v);
    setLabels(l);
    setLoaded(true);
    setTimeout(() => root.current?.querySelector<HTMLElement>('[data-nav]')?.focus(), 0);
  }, [isNew, defaults.data, record.data, def, loaded]);

  const readOnly = isNew ? !can(mod, 'create') : !can(mod, 'edit');
  const back = () => navigate(`/m/${def.key}`);

  const save = async (then: 'list' | 'new' = 'list') => {
    if (readOnly || saving) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const payload: Values = {};
      for (const f of def.fields) payload[f.name] = values[f.name];
      const saved = isNew
        ? await api.post<Rec>(`/masters/${def.key}`, payload)
        : await api.put<Rec>(`/masters/${def.key}/${id}`, { ...payload, version: record.data!.version });
      qc.invalidateQueries({ queryKey: ['masters', def.key] });
      qc.invalidateQueries({ queryKey: ['lookup', def.key] });
      if (def.key === 'companies') qc.invalidateQueries({ queryKey: ['session'] });
      toast.success(`${def.label} ${String(saved[def.displayField] ?? '')} saved`);
      setDirty(false);
      if (then === 'new') {
        setLoaded(false); // effect re-applies defaults and focuses the first field
      } else back();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(e.fields);
        const first = Object.keys(e.fields)[0];
        document.getElementById(`f-${first}`)?.focus();
      }
      setFormError(e);
    } finally {
      setSaving(false);
    }
  };

  const saveDefaults = async () => {
    if (!can('admin.defaults', 'edit')) return toast.error('You do not have permission to change defaults');
    const v: Values = {};
    for (const f of def.fields) if (!f.unique && f.type !== 'file' && values[f.name] !== null && values[f.name] !== '') v[f.name] = values[f.name];
    try {
      await api.put(`/defaults/${def.key}`, { values: v });
      qc.invalidateQueries({ queryKey: ['defaults', def.key] });
      toast.success(`Saved as defaults for new ${def.plural.toLowerCase()} in ${session?.activeCompany?.code}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  useHotkeys(
    {
      'mod+s, mod+enter': () => save('list'),
      'mod+shift+s': () => isNew && save('new'),
      'alt+d': saveDefaults,
      esc: () => (dirty ? setConfirmLeave(true) : back()),
    },
    [values, dirty, saving, record.data],
    { inInputs: true },
  );

  if ((!isNew && record.isLoading) || (isNew && defaults.isLoading)) return <Spinner />;
  if (record.error) return <div className="p-6"><ErrorBox error={record.error} /></div>;

  const rec = record.data;
  const title = isNew ? `New ${def.label.toLowerCase()}` : String(rec?.[def.displayField] ?? def.label);

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={root} data-form-root>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <button type="button" tabIndex={-1} onClick={back} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
            {title}
            {rec?._shared && <Badge tone="blue">Shared from {rec._ownerCode}</Badge>}
            {readOnly && <Badge>Read only</Badge>}
          </span>
        }
        subtitle={def.plural}
        actions={
          <>
            {!isNew && can('admin.audit', 'view') && (
              <Link to={`/admin/audit?entity=${def.key}&recordId=${id}`} className="inline-flex items-center gap-1 px-2 text-[12.5px] text-slate-500 hover:text-slate-800">
                <History className="size-3.5" /> History
              </Link>
            )}
            {isNew && can('admin.defaults', 'edit') && (
              <Button onClick={saveDefaults} shortcut="alt+d" title="Use the values on this form as defaults for new records">
                Save as defaults
              </Button>
            )}
            <Button onClick={() => (dirty ? setConfirmLeave(true) : back())} shortcut="esc">
              Cancel
            </Button>
            {!readOnly && (
              <Button variant="primary" data-nav-end icon={<Save className="size-3.5" />} loading={saving} onClick={() => save('list')} shortcut="mod+s">
                Save
              </Button>
            )}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-5xl space-y-3">
          {formError != null && <ErrorBox error={formError} />}
          <EntityForm
            def={def}
            values={values}
            labels={labels}
            errors={errors}
            readOnly={readOnly}
            onChange={(name, v, l) => {
              setValues((s) => ({ ...s, [name]: v }));
              if (l !== undefined) setLabels((s) => ({ ...s, [name]: l }));
              setErrors((s) => {
                if (!s[name]) return s;
                const n = { ...s };
                delete n[name];
                return n;
              });
              setDirty(true);
            }}
          />
          {!readOnly && (
            <div className="flex items-center justify-between pb-6 text-[12px] text-slate-500">
              <span>Enter = next field · Shift+Enter = previous · Ctrl+S = save{isNew ? ' · Ctrl+Shift+S = save & new' : ''}</span>
              {rec && <span>Last changed {new Date(rec.updatedAt as string).toLocaleString()} · v{rec.version}</span>}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmLeave}
        title="Discard changes?"
        message="You have unsaved changes on this form."
        confirmLabel="Discard"
        danger
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => back()}
      />
    </div>
  );
}
