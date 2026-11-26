import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, qs } from '../lib/api';

interface NumberFormat {
  prefix: string;
  suffix: string;
  next: string;
}

/**
 * Document number with the series part locked: "RMM/EX/26-27/" is fixed (it follows the document
 * date's financial year) and only the running number after it can be typed. Blank = the next number.
 * A number that does not fit the series (e.g. an older imported one) stays a plain, fully editable box.
 */
export function DocNumberInput({
  docKey,
  date,
  value,
  onChange,
  readOnly,
  isNew,
  invalid,
}: {
  docKey: string;
  date: string | null;
  value: string | null;
  onChange: (v: string | null) => void;
  readOnly?: boolean;
  isNew: boolean;
  invalid?: boolean;
}) {
  const q = useQuery({
    queryKey: ['number-format', docKey, date],
    queryFn: () => api.get<NumberFormat>(`/documents/${docKey}/number-format${qs({ date })}`),
    staleTime: 30_000,
    retry: false,
  });
  const f = q.data;
  const v = value ?? '';
  const fits = !!f && (f.prefix || f.suffix) && (v === '' || (v.startsWith(f.prefix) && v.endsWith(f.suffix) && v.length > f.prefix.length + f.suffix.length));
  const part = fits && v ? v.slice(f!.prefix.length, v.length - f!.suffix.length) : '';

  // When the date moves into another financial year the prefix changes: carry the typed number over.
  const last = useRef<NumberFormat | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = f ?? prev;
    if (!f || !prev || (prev.prefix === f.prefix && prev.suffix === f.suffix)) return;
    if (v && v.startsWith(prev.prefix) && v.endsWith(prev.suffix)) {
      const p = v.slice(prev.prefix.length, v.length - prev.suffix.length);
      if (p) onChange(f.prefix + p + f.suffix);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.prefix, f?.suffix]);

  if (!fits) {
    return (
      <input
        id="f-documentNumber"
        data-nav="1"
        className="field-input"
        disabled={readOnly}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        maxLength={64}
        value={v}
        placeholder={isNew && f ? `${f.prefix}${f.next}${f.suffix}` : undefined}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }

  const addon = 'flex items-center border border-slate-300 bg-slate-100 px-2 font-mono text-[12.5px] whitespace-nowrap text-slate-600 select-none';
  return (
    <div className="flex">
      {f!.prefix && (
        <span className={`${addon} rounded-l border-r-0`} title="Fixed by Document numbering (follows the date's financial year)">
          {f!.prefix}
        </span>
      )}
      <input
        id="f-documentNumber"
        data-nav="1"
        className="field-input min-w-0 font-mono"
        style={{ ...(f!.prefix ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 } : {}), ...(f!.suffix ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : {}) }}
        disabled={readOnly}
        aria-invalid={invalid || undefined}
        aria-label="Running number"
        autoComplete="off"
        inputMode="numeric"
        maxLength={20}
        value={part}
        placeholder={isNew ? f!.next : undefined}
        onChange={(e) => {
          const p = e.target.value.trim();
          onChange(p ? f!.prefix + p + f!.suffix : null);
        }}
      />
      {f!.suffix && <span className={`${addon} rounded-r border-l-0`}>{f!.suffix}</span>}
    </div>
  );
}
