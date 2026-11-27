import { freeTextName, type EntityDef, type FieldDef } from '@rmm/shared';
import type { KeyboardEvent, ReactNode } from 'react';
import { FileField } from './FileField';
import { imageKindOf } from './ImageEditor';
import { RefSelect, type FreeText } from './RefSelect';
import { SuggestInput, type SuggestSource } from './SuggestInput';
import { TemplateEditor } from './TemplateEditor';

/** Field types that offer "used before" suggestions (unique values / document numbers never do). */
const SUGGEST_TYPES = new Set(['text', 'textarea', 'email', 'date', 'decimal', 'integer']);
const canSuggest = (f: FieldDef) => SUGGEST_TYPES.has(f.type) && !f.unique && !f.template && f.name !== 'documentNumber';

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
  sameAs,
  suggest,
  freeText,
}: {
  f: FieldDef;
  value: unknown;
  label?: string | null;
  onChange: (v: unknown, label?: string | null) => void;
  error?: string;
  readOnly?: boolean;
  onCommit: () => void;
  sameAs?: { label: string; id: string | null; idLabel: string | null; text?: string | null };
  /** Offer values typed before in this field. */
  suggest?: SuggestSource;
  /** On a document ref: allow typing a value that is not in the dropdown. */
  freeText?: FreeText;
}) {
  const id = `f-${f.name}`;
  const common = { id, 'data-nav': '1', disabled: readOnly, 'aria-invalid': error ? true : undefined } as const;
  if (f.template) {
    return <TemplateEditor id={id} value={(value as string) ?? ''} onChange={onChange} multiline={f.template === 'block'} rows={10} disabled={readOnly} invalid={!!error} ariaLabel={f.label} nav />;
  }
  switch (f.type) {
    case 'textarea':
      if (suggest) return <SuggestInput {...common} multiline rows={3} className="field-input resize-y" source={suggest} value={(value as string) ?? ''} onValue={(v) => onChange(v)} />;
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
          allowCreate={f.type === 'ref' && f.allowCreate}
          sameAs={sameAs}
          freeText={f.type === 'ref' ? freeText : undefined}
          onChange={(v, l) => onChange(v, l)}
          onCommit={onCommit}
        />
      );
    case 'file':
      return <FileField id={id} value={(value as string) ?? null} onChange={(v) => onChange(v)} disabled={readOnly} kind={imageKindOf(f.name)} />;
    default: {
      const box = {
        ...common,
        type: f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text',
        inputMode: f.type === 'decimal' ? ('decimal' as const) : f.type === 'integer' ? ('numeric' as const) : undefined,
        maxLength: f.maxLength,
        className: `field-input ${f.upper ? 'uppercase' : ''} ${f.type === 'decimal' || f.type === 'integer' ? 'text-right tabular-nums' : ''}`,
      };
      const text = value === null || value === undefined ? '' : String(value);
      if (suggest || f.choices?.length) return <SuggestInput {...box} source={suggest} choices={f.choices} upper={f.upper} value={text} onValue={(v) => onChange(v)} />;
      return <input {...box} autoComplete="off" value={text} onChange={(e) => onChange(e.target.value)} />;
    }
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
  suggestFrom,
  renderField,
}: {
  def: EntityDef;
  values: Values;
  labels: Record<string, string | null | undefined>;
  errors: Record<string, string>;
  readOnly?: boolean;
  onChange: (name: string, value: unknown, label?: string | null) => void;
  footer?: ReactNode;
  /** Registry key (master or document) whose earlier values each box should suggest. */
  suggestFrom?: { key: string; part?: 'header' | 'lines' };
  /** Custom input for a field (return undefined to use the standard one). */
  renderField?: (f: FieldDef) => ReactNode | undefined;
}) {
  // group fields into sections (a field with `section` starts a new one)
  const sections: { title: string; fields: FieldDef[] }[] = [];
  for (const f of def.fields) {
    if (f.section || !sections.length) sections.push({ title: f.section ?? 'Details', fields: [] });
    sections[sections.length - 1].fields.push(f);
  }

  // Fields switched off by a `controls` boolean are hidden (and left off the PDF).
  const off = new Set<string>();
  for (const f of def.fields) {
    if (f.type === 'boolean' && f.controls && values[f.name] === false) for (const n of f.controls) off.add(n);
  }
  const shown = (f: FieldDef) => !f.hidden && !off.has(f.name);
  const labelFor = (name: string) => def.fields.find((x) => x.name === name)?.label ?? name;

  return (
    <div onKeyDown={enterNavigation} className="space-y-4">
      {sections
        .map((s) => ({ ...s, fields: s.fields.filter(shown) }))
        .filter((s) => s.fields.length)
        .map((s) => (
          <fieldset key={s.title} className="rounded-md border border-slate-200 bg-white px-4 pt-2 pb-4 shadow-xs">
            <legend className="px-1 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">{s.title}</legend>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.fields.map((f) => {
                // "Same as" copies the other field's record — or its typed free text.
                const sameText = f.sameAs ? ((values[freeTextName(f.sameAs)] as string | null) ?? null) : null;
                const sameAs =
                  f.sameAs && (values[f.sameAs] || sameText)
                    ? { label: labelFor(f.sameAs), id: (values[f.sameAs] as string) ?? null, idLabel: (labels[f.sameAs] as string) ?? null, text: sameText }
                    : undefined;
                const companion = f.type === 'ref' ? def.fields.find((x) => x.freeTextOf === f.name) : undefined;
                const freeText = companion
                  ? {
                      value: (values[companion.name] as string | null) ?? null,
                      onChange: (t: string | null) => onChange(companion.name, t),
                      suggest: suggestFrom ? { key: suggestFrom.key, part: suggestFrom.part, field: companion.name } : undefined,
                    }
                  : undefined;
                const suggest = suggestFrom && canSuggest(f) ? { key: suggestFrom.key, part: suggestFrom.part, field: f.name } : undefined;
                const custom = renderField?.(f);
                return (
                  <div key={f.name} className={spanClass[f.span ?? (f.type === 'textarea' ? 3 : 1)]}>
                    <label htmlFor={`f-${f.name}`} className="mb-1 block text-[12.5px] font-medium text-slate-600">
                      {f.label}
                      {f.required && <span className="text-red-500"> *</span>}
                    </label>
                    {custom ?? (
                      <FieldInput
                        f={f}
                        value={values[f.name]}
                        label={labels[f.name]}
                        error={errors[f.name]}
                        readOnly={readOnly}
                        sameAs={sameAs}
                        suggest={suggest}
                        freeText={freeText}
                        onChange={(v, l) => onChange(f.name, v, l)}
                        onCommit={() => {
                          const el = document.getElementById(`f-${f.name}`);
                          const root = el?.closest('[data-form-root]') as HTMLElement | null;
                          if (el && root) focusSibling(root, el, 1);
                        }}
                      />
                    )}
                    {errors[f.name] ? (
                      <div className="mt-0.5 text-[12px] text-red-600">{errors[f.name]}</div>
                    ) : f.help ? (
                      <div className="mt-0.5 text-[11.5px] text-slate-400">{f.help}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      {footer}
    </div>
  );
}
