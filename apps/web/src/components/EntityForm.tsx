import type { EntityDef, FieldDef } from '@rmm/shared';
import type { KeyboardEvent, ReactNode } from 'react';
import { FileField } from './FileField';
import { imageKindOf } from './ImageEditor';
import { RefSelect } from './RefSelect';

export type Values = Record<string, unknown>;

const NAV = '[data-nav]:not([disabled])';

/**
 * Tally-style keyboard flow for any container:
 *   Enter → next field, Shift+Enter → previous field.
 *   On the last field Enter moves to the element marked data-nav-end (the Save button).
 * Textareas keep Enter for new lines (use Tab / Ctrl+Enter there).
 */
export function enterNavigation(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t.tagName === 'TEXTAREA' || t.dataset.comboboxOpen || t.tagName === 'BUTTON') return;
  if (!t.matches(NAV)) return;
  e.preventDefault();
  focusSibling(e.currentTarget, t, e.shiftKey ? -1 : 1);
}

export function focusSibling(root: HTMLElement, from: HTMLElement, dir: 1 | -1) {
  const els = [...root.querySelectorAll<HTMLElement>(NAV)];
  const i = els.indexOf(from);
  const next = els[i + dir];
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement && next.type === 'text') next.select();
  } else if (dir === 1) {
    root.querySelector<HTMLElement>('[data-nav-end]')?.focus();
  }
}

const spanClass = { 1: '', 2: 'sm:col-span-2', 3: 'sm:col-span-2 lg:col-span-3' } as const;

function FieldInput({
  f,
  value,
  label,
  onChange,
  error,
  readOnly,
  onCommit,
}: {
  f: FieldDef;
  value: unknown;
  label?: string | null;
  onChange: (v: unknown, label?: string | null) => void;
  error?: string;
  readOnly?: boolean;
  onCommit: () => void;
}) {
  const id = `f-${f.name}`;
  const common = { id, 'data-nav': '1', disabled: readOnly, 'aria-invalid': error ? true : undefined } as const;
  switch (f.type) {
    case 'textarea':
      return <textarea {...common} rows={3} className="field-input resize-y" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
      return (
        <label className="inline-flex h-[34px] items-center gap-2">
          <input
            {...common}
            type="checkbox"
            className="size-4 accent-brand-700"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            onKeyDown={(e) => {
              if (e.key === ' ') return; // native toggle
            }}
          />
          <span className="text-slate-600">{value ? 'Yes' : 'No'}</span>
        </label>
      );
    case 'select':
      return (
        <select {...common} className="field-input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {f.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'ref':
    case 'doc':
      return (
        <RefSelect
          id={id}
          source={f.type === 'doc' ? 'document' : 'master'}
          entity={f.ref!}
          value={(value as string) ?? null}
          label={label}
          disabled={readOnly}
          invalid={!!error}
          onChange={(v, l) => onChange(v, l)}
          onCommit={onCommit}
        />
      );
    case 'file':
      return <FileField id={id} value={(value as string) ?? null} onChange={(v) => onChange(v)} disabled={readOnly} kind={imageKindOf(f.name)} />;
    default:
      return (
        <input
          {...common}
          type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
          inputMode={f.type === 'decimal' ? 'decimal' : f.type === 'integer' ? 'numeric' : undefined}
          autoComplete="off"
          maxLength={f.maxLength}
          className={`field-input ${f.upper ? 'uppercase' : ''} ${f.type === 'decimal' || f.type === 'integer' ? 'text-right tabular-nums' : ''}`}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function EntityForm({
  def,
  values,
  labels,
  errors,
  readOnly,
  onChange,
  footer,
}: {
  def: EntityDef;
  values: Values;
  labels: Record<string, string | null | undefined>;
  errors: Record<string, string>;
  readOnly?: boolean;
  onChange: (name: string, value: unknown, label?: string | null) => void;
  footer?: ReactNode;
}) {
  // group fields into sections (a field with `section` starts a new one)
  const sections: { title: string; fields: FieldDef[] }[] = [];
  for (const f of def.fields) {
    if (f.section || !sections.length) sections.push({ title: f.section ?? 'Details', fields: [] });
    sections[sections.length - 1].fields.push(f);
  }

  return (
    <div onKeyDown={enterNavigation} className="space-y-4">
      {sections.map((s) => (
        <fieldset key={s.title} className="rounded-md border border-slate-200 bg-white px-4 pt-2 pb-4 shadow-xs">
          <legend className="px-1 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">{s.title}</legend>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.fields.map((f) => (
              <div key={f.name} className={spanClass[f.span ?? (f.type === 'textarea' ? 3 : 1)]}>
                <label htmlFor={`f-${f.name}`} className="mb-1 block text-[12.5px] font-medium text-slate-600">
                  {f.label}
                  {f.required && <span className="text-red-500"> *</span>}
                </label>
                <FieldInput
                  f={f}
                  value={values[f.name]}
                  label={labels[f.name]}
                  error={errors[f.name]}
                  readOnly={readOnly}
                  onChange={(v, l) => onChange(f.name, v, l)}
                  onCommit={() => {
                    const el = document.getElementById(`f-${f.name}`);
                    const root = el?.closest('[data-form-root]') as HTMLElement | null;
                    if (el && root) focusSibling(root, el, 1);
                  }}
                />
                {errors[f.name] ? (
                  <div className="mt-0.5 text-[12px] text-red-600">{errors[f.name]}</div>
                ) : f.help ? (
                  <div className="mt-0.5 text-[11.5px] text-slate-400">{f.help}</div>
                ) : null}
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      {footer}
    </div>
  );
}
