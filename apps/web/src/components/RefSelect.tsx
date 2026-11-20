import { getEntity } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError, qs } from '../lib/api';
import { showError } from '../lib/notify';
import { EntityForm, type Values } from './EntityForm';
import { Modal } from './Modal';
import { Button } from './ui';

interface Option {
  id: string;
  label: string;
  sub?: string;
}

/**
 * Searchable lookup for "ref" fields.
 * Type to search · ↑↓ choose · Enter select (and move on) · Esc close · F2 / Alt+↓ open · Backspace on empty clears.
 */
export function RefSelect({
  entity,
  value,
  label: initialLabel,
  onChange,
  id,
  invalid,
  disabled,
  placeholder = 'Type to search…',
  onCommit,
  source = 'master',
  allowCreate = false,
  sameAs,
}: {
  /** master entity key, or a document key when source is 'document' */
  entity: string;
  source?: 'master' | 'document';
  value: string | null;
  label?: string | null;
  onChange: (id: string | null, label: string | null) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Called after Enter selects an option (form moves to next field). */
  onCommit?: () => void;
  /** Allow creating a new master record straight from the picker. */
  allowCreate?: boolean;
  /** Offer "— same as <label> —" at the top of the list (copies another field's value). */
  sameAs?: { label: string; id: string; idLabel: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const [label, setLabel] = useState<string | null>(initialLabel ?? null);
  const [creating, setCreating] = useState<string | null>(null);
  const listId = useId();
  const base = source === 'document' ? `/documents/${entity}/lookup` : `/masters/${entity}/lookup`;
  const canCreate = allowCreate && source === 'master' && !disabled && !!getEntity(entity);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve a label for an existing value (e.g. defaults applied by id).
  const resolve = useQuery({
    queryKey: ['lookup', source, entity, 'ids', value],
    queryFn: () => api.get<Option[]>(`${base}${qs({ ids: value })}`),
    enabled: !!value && !label,
  });
  useEffect(() => {
    if (resolve.data?.[0]) setLabel(resolve.data[0].label);
  }, [resolve.data]);
  useEffect(() => {
    if (!value) setLabel(null);
  }, [value]);
  useEffect(() => {
    if (initialLabel) setLabel(initialLabel);
  }, [initialLabel]);

  const search = useQuery({
    queryKey: ['lookup', source, entity, text],
    queryFn: () => api.get<Option[]>(`${base}${qs({ q: text, limit: 30 })}`),
    enabled: open,
    staleTime: 30_000,
  });
  const options = search.data ?? [];
  // "— same as X —" sits at the top of the list and is navigable with the arrows too (index 0).
  const samePresent = !!(sameAs && sameAs.id !== value);
  const offset = samePresent ? 1 : 0;
  const navLen = offset + options.length;
  useEffect(() => setHi(samePresent && !text ? 0 : offset), [text, open, samePresent, offset]);

  const pick = (idx: number) => {
    if (samePresent && idx === 0) return choose({ id: sameAs!.id, label: sameAs!.idLabel ?? sameAs!.label }, true);
    const o = options[idx - offset];
    if (o) choose(o, true);
  };

  const choose = (o: Option | null, commit = false) => {
    onChange(o?.id ?? null, o?.label ?? null);
    setLabel(o?.label ?? null);
    setText('');
    setOpen(false);
    if (commit) onCommit?.();
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          data-nav="1"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-activedescendant={open && hi < navLen ? `${listId}-${hi}` : undefined}
          data-combobox-open={open ? '1' : undefined}
          disabled={disabled}
          className="field-input pr-12"
          placeholder={label ? undefined : placeholder}
          value={open ? text : (label ?? '')}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if ((e.key === 'F2' || (e.altKey && e.key === 'ArrowDown')) && !open) {
              e.preventDefault();
              setText('');
              setOpen(true);
              return;
            }
            if (!open) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setText('');
                setOpen(true);
              } else if ((e.key === 'Backspace' || e.key === 'Delete') && value) {
                e.preventDefault();
                choose(null);
              }
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, navLen - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              pick(hi);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setText('');
            } else if (e.key === 'Tab' && text) {
              const o = options[hi - offset];
              if (o) choose(o);
            }
          }}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 text-slate-400">
          {value && !disabled && (
            <button type="button" tabIndex={-1} aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)} className="rounded p-0.5 hover:bg-slate-100">
              <X className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Open list"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
            className="rounded p-0.5 hover:bg-slate-100"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded border border-slate-200 bg-white py-1 shadow-lg">
          {samePresent && (
            <li
              id={`${listId}-0`}
              role="option"
              aria-selected={hi === 0}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(0)}
              onClick={() => choose({ id: sameAs!.id, label: sameAs!.idLabel ?? sameAs!.label }, true)}
              className={`cursor-pointer px-3 py-1.5 font-medium text-brand-700 italic ${hi === 0 ? 'bg-brand-50' : 'hover:bg-brand-50'}`}
            >
              — same as {sameAs!.label.toLowerCase()} —
            </li>
          )}
          {search.isLoading && <li className="px-3 py-1.5 text-slate-400">Searching…</li>}
          {!search.isLoading && options.length === 0 && !canCreate && <li className="px-3 py-1.5 text-slate-400">No matches</li>}
          {!search.isLoading && options.length === 0 && canCreate && <li className="px-3 py-1.5 text-slate-400">No matches — add a new one below</li>}
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i + offset}`}
              role="option"
              aria-selected={i + offset === hi}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i + offset)}
              onClick={() => choose(o, true)}
              className={`flex cursor-pointer justify-between gap-3 px-3 py-1.5 ${i + offset === hi ? 'bg-brand-50 text-brand-900' : ''} ${o.id === value ? 'font-medium' : ''}`}
            >
              <span className="truncate">{o.label}</span>
              {o.sub && <span className="shrink-0 font-mono text-[11.5px] text-slate-400">{o.sub}</span>}
            </li>
          ))}
          {canCreate && (
            <li className="sticky bottom-0 border-t border-slate-100 bg-white">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-brand-700 hover:bg-brand-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setCreating(text.trim());
                  setOpen(false);
                }}
              >
                <Plus className="size-3.5" /> Add {text.trim() ? `"${text.trim()}"` : 'a new one'}
              </button>
            </li>
          )}
        </ul>
      )}
      {creating !== null && (
        <CreateMaster
          entity={entity}
          initialName={creating}
          onClose={() => setCreating(null)}
          onCreated={(o) => {
            choose(o, true);
            setCreating(null);
          }}
        />
      )}
    </div>
  );
}

/** Quick-create a master record (buyer, product, packing…) without leaving the document. */
function CreateMaster({ entity, initialName, onClose, onCreated }: { entity: string; initialName: string; onClose: () => void; onCreated: (o: Option) => void }) {
  const def = getEntity(entity)!;
  const qc = useQueryClient();
  const nameField = def.fields.find((f) => f.name === 'name') ? 'name' : def.displayField;
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    for (const f of def.fields) if (f.default !== undefined) v[f.name] = f.default;
    if (initialName) v[nameField] = initialName;
    return v;
  });
  const [labelMap, setLabelMap] = useState<Record<string, string | null | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Keep the quick-add short: only required fields, a name/display field, plus any already filled.
  const fields = def.fields.filter((f) => f.name !== 'isActive' && (f.required || f.name === nameField || f.name === 'code' || values[f.name] != null));

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const created = await api.post<Values>(`/masters/${entity}`, values);
      qc.invalidateQueries({ queryKey: ['lookup', 'master', entity] });
      qc.invalidateQueries({ queryKey: ['masters', entity] });
      onCreated({ id: String(created.id), label: String(created[def.displayField] ?? values[nameField] ?? '') });
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k.replace(/^.*\./, ''), m])));
      else showError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`New ${def.label.toLowerCase()}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save} data-nav-end>
            Add & select
          </Button>
        </>
      }
    >
      <div data-form-root className="max-h-[60vh] overflow-y-auto pr-1">
        <EntityForm
          def={{ ...def, fields }}
          values={values}
          labels={labelMap}
          errors={errors}
          onChange={(n, v, l) => {
            setValues((s) => ({ ...s, [n]: v }));
            if (l !== undefined) setLabelMap((s) => ({ ...s, [n]: l }));
          }}
        />
      </div>
    </Modal>
  );
}
