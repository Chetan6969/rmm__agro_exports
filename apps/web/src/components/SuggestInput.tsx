import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Fragment, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { api, qs } from '../lib/api';

/** Which registry field a box belongs to: a master key or a document key (+ header / product lines). */
export interface SuggestSource {
  key: string;
  field: string;
  part?: 'header' | 'lines';
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Values typed before in the same field (newest first). Fetched only while the box is focused. */
export function useSuggestions(src: SuggestSource | undefined, enabled: boolean, q: string) {
  const dq = useDebounced(q, 200);
  return useQuery({
    queryKey: ['suggest', src?.key, src?.part ?? 'header', src?.field, dq],
    queryFn: () => api.get<string[]>(`/suggest${qs({ key: src!.key, field: src!.field, part: src!.part, q: dq })}`),
    enabled: enabled && !!src,
    staleTime: 60_000,
    retry: false,
  });
}

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const showValue = (v: string) =>
  isIsoDate(v) ? new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : v;

type BoxProps = {
  id?: string;
  className?: string;
  disabled?: boolean;
  type?: string;
  inputMode?: 'decimal' | 'numeric';
  maxLength?: number;
  placeholder?: string;
  rows?: number;
  'data-nav'?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
};

/**
 * A text / date / number box (or textarea) that, when focused, lists the values entered before in the
 * same field. Click one to fill it. Keyboard: ↓ (Alt+↓ in date boxes and text areas) enters the list,
 * ↑↓ move, Enter picks, Esc closes. Without a `source` it is a plain box.
 */
export function SuggestInput({
  source,
  value,
  onValue,
  multiline,
  upper,
  choices,
  ...box
}: BoxProps & {
  source?: SuggestSource;
  value: string;
  onValue: (v: string) => void;
  multiline?: boolean;
  upper?: boolean;
  /** Common values always offered (filtered by what is typed); the box still takes any other value. */
  choices?: readonly string[];
}) {
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState(false); // typed since focus → filter by what is in the box
  const [closed, setClosed] = useState(false); // Esc / a pick closes it until the next focus
  const [hi, setHi] = useState(-1);
  const listId = useId();
  const isDate = box.type === 'date';
  const sug = useSuggestions(source, focused && !closed && !box.disabled, typed && !isDate ? value : '');
  const needle = typed ? value.trim().toLowerCase() : '';
  const common = (choices ?? []).filter((c) => c !== value && (!needle || c.toLowerCase().includes(needle)));
  const seen = new Set((choices ?? []).map((c) => c.toLowerCase()));
  const history = (sug.data ?? []).filter((v) => v !== value && !seen.has(v.toLowerCase())).slice(0, 10);
  const items = [...common, ...history];
  const open = focused && !closed && !box.disabled && items.length > 0;

  useEffect(() => setHi(-1), [open, items.length]);

  const pick = (v: string) => {
    onValue(upper ? v.toUpperCase() : v);
    setClosed(true);
    setHi(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open) return;
    // Plain ↑↓ belong to the box itself in dates (step the day) and text areas (move the caret).
    const plainArrowsOwned = isDate || multiline;
    if (e.key === 'ArrowDown' && (hi >= 0 || !plainArrowsOwned || e.altKey)) {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === 'ArrowUp' && hi >= 0) {
      e.preventDefault();
      setHi((h) => h - 1);
    } else if (e.key === 'Enter' && hi >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pick(items[hi]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setClosed(true);
      setHi(-1);
    }
  };

  const shared = {
    ...box,
    autoComplete: 'off',
    role: 'combobox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-activedescendant': open && hi >= 0 ? `${listId}-${hi}` : undefined,
    // Let the form's Enter-to-next-field and Esc-to-leave stand aside while the list is in use.
    'data-combobox-open': open && hi >= 0 ? '1' : undefined,
    'data-suggest-open': open ? '1' : undefined,
    value,
    onFocus: () => {
      setFocused(true);
      setTyped(false);
      setClosed(false);
    },
    onBlur: () => setTimeout(() => setFocused(false), 120),
    onKeyDown,
  };

  return (
    <div className="relative">
      {multiline ? (
        <textarea
          {...shared}
          onChange={(e) => {
            setTyped(true);
            setClosed(false);
            onValue(e.target.value);
          }}
        />
      ) : (
        <input
          {...shared}
          onChange={(e) => {
            setTyped(true);
            setClosed(false);
            onValue(e.target.value);
          }}
        />
      )}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-56 w-full min-w-48 overflow-auto rounded border border-slate-200 bg-white py-1 text-[13px] shadow-lg">
          {items.map((v, i) => (
            <Fragment key={v}>
              {i === 0 && common.length > 0 && (
                <li className="px-3 pt-0.5 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">Common · or type any other</li>
              )}
              {i === common.length && (
                <li className="flex items-center gap-1 px-3 pt-1 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                  <History className="size-3" /> Used before
                </li>
              )}
            <li
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(v)}
              className={`cursor-pointer truncate px-3 py-1.5 ${i === hi ? 'bg-brand-50 text-brand-900' : 'hover:bg-brand-50'} ${multiline ? 'whitespace-pre-line' : ''}`}
              title={v}
            >
              {multiline ? v.split(/\r?\n/).slice(0, 2).join('\n') : showValue(v)}
            </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
