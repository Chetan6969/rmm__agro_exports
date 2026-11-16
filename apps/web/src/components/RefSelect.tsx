import { useQuery } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, qs } from '../lib/api';

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
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const [label, setLabel] = useState<string | null>(initialLabel ?? null);
  const listId = useId();
  const base = source === 'document' ? `/documents/${entity}/lookup` : `/masters/${entity}/lookup`;
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
  useEffect(() => setHi(0), [text, open]);

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
          aria-activedescendant={open && options[hi] ? `${listId}-${hi}` : undefined}
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
              setHi((h) => Math.min(h + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (options[hi]) choose(options[hi], true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setText('');
            } else if (e.key === 'Tab' && options[hi] && text) {
              choose(options[hi]);
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
          {search.isLoading && <li className="px-3 py-1.5 text-slate-400">Searching…</li>}
          {!search.isLoading && options.length === 0 && <li className="px-3 py-1.5 text-slate-400">No matches</li>}
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => choose(o, true)}
              className={`flex cursor-pointer justify-between gap-3 px-3 py-1.5 ${i === hi ? 'bg-brand-50 text-brand-900' : ''} ${o.id === value ? 'font-medium' : ''}`}
            >
              <span className="truncate">{o.label}</span>
              {o.sub && <span className="shrink-0 font-mono text-[11.5px] text-slate-400">{o.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
