/**
 * One list, order by order: each PO / PI is a closed folder; click it (or ↑ ↓ then Enter) to see what
 * is inside. Used by Shipments, the tracker, the document inbox, packaging POs and freight, so a
 * screen with hundreds of orders stays readable.
 */
import { ChevronDown, ChevronRight, FolderOpen, Inbox } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useHotkeys } from '../lib/hotkeys';

export interface OrderGroupKey {
  orderId: string | null;
  orderNumber: string | null;
  buyer: string | null;
  buyerPoRef?: string | null;
  /** 'Our PI' or 'Buyer PO / contract'. */
  orderSource?: string | null;
}

export interface OrderGroup<T> extends OrderGroupKey {
  items: T[];
}

/** Put rows into one group per order, keeping the rows' own order; rows without an order come first. */
export function groupByOrder<T>(rows: T[], keyOf: (r: T) => OrderGroupKey): OrderGroup<T>[] {
  const map = new Map<string, OrderGroup<T>>();
  for (const r of rows) {
    const k = keyOf(r);
    const id = k.orderId ?? '';
    const g = map.get(id) ?? { ...k, items: [] };
    g.items.push(r);
    map.set(id, g);
  }
  return [...map.values()].sort((a, b) => Number(!!a.orderId) - Number(!!b.orderId));
}

export function Chip({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'amber' | 'red' | 'green' | 'blue' }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-700', green: 'bg-emerald-100 text-emerald-700', blue: 'bg-sky-100 text-sky-700' };
  return <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export const isOurPi = (source: string | null | undefined) => source === 'Our PI';
export const SourceChip = ({ source }: { source: string | null | undefined }) => (source ? <Chip tone={isOurPi(source) ? 'slate' : 'blue'}>{isOurPi(source) ? 'Our PI' : 'Buyer PO'}</Chip> : null);

export const SOURCE_FILTERS = [
  { key: '', label: 'Buyer PO + PI' },
  { key: 'po', label: 'Buyer PO' },
  { key: 'pi', label: 'Our PI' },
];
/** All / Buyer PO / Our PI switch, the same on every order-wise screen. */
export function SourceFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-md border border-slate-300 bg-white p-0.5" role="group" aria-label="Order type">
      {SOURCE_FILTERS.map((f) => (
        <button key={f.key} type="button" aria-pressed={value === f.key} onClick={() => onChange(f.key)} className={`rounded px-2 py-0.5 text-[12px] ${value === f.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function OrderGroups<G extends OrderGroupKey>({
  groups,
  summary,
  children,
  pageSize = 20,
  keyboard = true,
  noOrderLabel = 'Not linked to any order yet',
  /** Total number of groups when the server pages them (then `page` / `onPage` drive the pager). */
  total,
  page: serverPage,
  onPage,
  /** Which folders start open (by default only when there is just one). */
  defaultOpen,
  /** Server-side Buyer PO / PI filter; without it the folders are filtered here. */
  source: serverSource,
  onSource,
}: {
  groups: G[];
  summary: (g: G) => ReactNode;
  children: (g: G) => ReactNode;
  pageSize?: number;
  keyboard?: boolean;
  noOrderLabel?: string;
  total?: number;
  page?: number;
  onPage?: (p: number) => void;
  defaultOpen?: (g: G) => boolean;
  source?: string;
  onSource?: (s: string) => void;
}) {
  const [localPage, setLocalPage] = useState(1);
  const page = serverPage ?? localPage;
  const setPage = onPage ?? setLocalPage;
  const [localSource, setLocalSource] = useState('');
  const source = serverSource ?? localSource;
  const shown = onSource || !localSource ? groups : groups.filter((g) => g.orderId && isOurPi(g.orderSource) === (localSource === 'pi'));
  const count = total ?? shown.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const visible = total === undefined ? shown.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize) : shown;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState(0);
  const idOf = (g: G) => g.orderId ?? 'none';
  // `open` holds the folders the user flipped from their starting state
  const isOpen = (g: G) => open.has(idOf(g)) !== (defaultOpen ? defaultOpen(g) : groups.length === 1);
  const toggle = (g: G) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(idOf(g))) n.add(idOf(g));
      return n;
    });
  useEffect(() => {
    setSel(0);
  }, [page, count]);
  useHotkeys(
    {
      arrowdown: () => setSel((i) => Math.min(i + 1, visible.length - 1)),
      arrowup: () => setSel((i) => Math.max(i - 1, 0)),
      'enter, arrowright, arrowleft': () => visible[sel] && toggle(visible[sel]),
    },
    [visible, sel],
    { enabled: keyboard },
  );

  return (
    <div className="space-y-2">
      {(source || onSource || groups.some((g) => g.orderSource)) && (
        <SourceFilter
          value={source}
          onChange={(v) => {
            (onSource ?? setLocalSource)(v);
            setPage(1);
          }}
        />
      )}
      {!visible.length && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-[13px] text-slate-500">No orders of this type here.</div>}
      {visible.map((g, i) => {
        const expanded = isOpen(g);
        return (
          <section key={idOf(g)} className={`overflow-hidden rounded-lg border bg-white shadow-xs ${i === sel && keyboard ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-slate-200'}`}>
            <div
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${expanded ? 'border-b border-slate-200 bg-slate-50' : 'hover:bg-slate-50'}`}
              ref={(el) => {
                if (i === sel && keyboard) el?.scrollIntoView({ block: 'nearest' });
              }}
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => {
                  setSel(i);
                  toggle(g);
                }}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
              >
                {expanded ? <ChevronDown className="size-4 shrink-0 text-slate-500" /> : <ChevronRight className="size-4 shrink-0 text-slate-400" />}
                {g.orderId ? (
                  <>
                    <span className="font-mono text-[13px] font-semibold text-slate-900">{g.orderNumber}</span>
                    <SourceChip source={g.orderSource} />
                    <span className="text-[13px] text-slate-600">{g.buyer ?? '—'}</span>
                    {g.buyerPoRef && <span className="text-[12px] text-slate-400">PO {g.buyerPoRef}</span>}
                  </>
                ) : (
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-800">
                    <Inbox className="size-4" /> {noOrderLabel}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap items-center gap-1.5">{summary(g)}</span>
              </button>
              {g.orderId && (
                <Link to={`/orders/${g.orderId}`} className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[12px] font-medium text-slate-700 hover:border-brand-600 hover:text-brand-700">
                  <FolderOpen className="size-3.5" /> Order file
                </Link>
              )}
            </div>
            {expanded && <div>{children(g)}</div>}
          </section>
        );
      })}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1 text-[12.5px] text-slate-500">
          <span>
            {count} orders · page {Math.min(page, pages)} of {pages}
          </span>
          <span className="flex gap-1">
            <button type="button" className="rounded border border-slate-300 bg-white px-2.5 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button type="button" className="rounded border border-slate-300 bg-white px-2.5 py-1 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </span>
        </div>
      )}
      {keyboard && visible.length > 0 && <div className="text-[12px] text-slate-400 max-md:hidden">↑ ↓ choose an order · Enter open / close it</div>}
    </div>
  );
}
