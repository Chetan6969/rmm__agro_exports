import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export interface DataGridHandle {
  focus: () => void;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  getId: (row: T) => string;
  onOpen?: (row: T) => void;
  onDelete?: (row: T) => void;
  onPage?: (dir: 1 | -1) => void;
  /** Called when ↑ is pressed on the first row (e.g. to return to the search box). */
  onExitTop?: () => void;
  loading?: boolean;
  empty?: ReactNode;
  label: string;
}

/**
 * Keyboard-driven table: ↑/↓ move, Home/End jump, Enter opens, Delete deletes,
 * PageUp/PageDown change page. Mouse: click selects, double-click opens.
 */
function DataGridInner<T>(
  { columns, rows, getId, onOpen, onDelete, onPage, onExitTop, loading, empty, label }: Props<T>,
  ref: React.Ref<DataGridHandle>,
) {
  const [sel, setSel] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => wrap.current?.focus() }), []);
  useEffect(() => setSel((s) => Math.min(s, Math.max(rows.length - 1, 0))), [rows]);
  useEffect(() => {
    wrap.current?.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const row = rows[sel];
    switch (e.key) {
      case 'ArrowDown':
        setSel((s) => Math.min(s + 1, rows.length - 1));
        break;
      case 'ArrowUp':
        if (sel === 0 && onExitTop) onExitTop();
        else setSel((s) => Math.max(s - 1, 0));
        break;
      case 'Home':
        setSel(0);
        break;
      case 'End':
        setSel(rows.length - 1);
        break;
      case 'PageDown':
        onPage?.(1);
        setSel(0);
        break;
      case 'PageUp':
        onPage?.(-1);
        setSel(0);
        break;
      case 'Enter':
        if (row) onOpen?.(row);
        break;
      case 'Delete':
        if (row) onDelete?.(row);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={wrap}
      tabIndex={0}
      role="grid"
      aria-label={label}
      aria-rowcount={rows.length}
      aria-activedescendant={rows[sel] ? `row-${getId(rows[sel])}` : undefined}
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-auto bg-white focus-visible:outline-offset-[-2px]"
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_var(--color-slate-200)]">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 text-[11.5px] font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={getId(r)}
              id={`row-${getId(r)}`}
              data-row={i}
              role="row"
              aria-selected={i === sel}
              onClick={() => setSel(i)}
              onDoubleClick={() => onOpen?.(r)}
              className="grid-row cursor-default border-b border-slate-100 hover:bg-slate-50"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`max-w-[280px] truncate px-3 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''} ${c.className ?? ''}`}
                >
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && <div className="p-8 text-center text-slate-500">{empty ?? 'No records'}</div>}
      {loading && <div className="absolute inset-x-0 top-9 h-0.5 animate-pulse bg-brand-500" />}
    </div>
  );
}

export const DataGrid = forwardRef(DataGridInner) as <T>(p: Props<T> & { ref?: React.Ref<DataGridHandle> }) => ReturnType<typeof DataGridInner>;
