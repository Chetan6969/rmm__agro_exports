/**
 * Shipment tracker — the old "Track Sheet", kept by the ERP: every lot with its line, booking,
 * invoice, BL, shipping bill, LC, ETA, documents and payment, with alerts. A row opens the lot:
 * tracking fields and the document checklist.
 */
import { BL_STATUSES, formatAmount, intakeKind } from '@rmm/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, ExternalLink, FileUp, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { enterNavigation } from '../../components/EntityForm';
import { Modal } from '../../components/Modal';
import { Chip, groupByOrder, OrderGroups } from '../../components/OrderGroups';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { useDebounced } from '../MasterListPage';
import { uploadToInbox } from './InboxPage';

interface TrackRow {
  id: string;
  lotNo: number;
  market: string;
  status: string;
  period: string | null;
  quantityMt: string;
  containerCount: number;
  targetShipDate: string | null;
  shippingLine: string | null;
  bookingNo: string | null;
  vessel: string | null;
  etd: string | null;
  eta: string | null;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  blNumber: string | null;
  blDate: string | null;
  blStatus: string;
  sbNumber: string | null;
  leoDate: string | null;
  orderId: string;
  orderNumber: string;
  buyerPoRef: string | null;
  lcNumber: string | null;
  buyer: string | null;
  orderSource: string | null;
  docsDone: number;
  docsNeeded: number;
  received: string;
  payment: 'PENDING' | 'PART' | 'RECEIVED';
  alerts: string[];
}

const d = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const BL_TONE: Record<string, 'slate' | 'amber' | 'green' | 'blue'> = { PENDING: 'slate', DRAFT: 'amber', RECEIVED: 'green', RELEASED: 'blue' };
const PAY_TONE = { PENDING: 'slate', PART: 'amber', RECEIVED: 'green' } as const;

export function TrackerPage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const market = params.get('market') ?? '';
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const [open, setOpen] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ['tracker', status, market, debounced],
    queryFn: () => api.get<TrackRow[]>(`/tracker${qs({ status, market, search: debounced })}`),
    placeholderData: keepPreviousData,
    enabled: !!session?.activeCompany,
  });
  const rows = q.data ?? [];
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  useEffect(() => set('search', debounced), [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useHotkeys(
    {
      '/': () => searchRef.current?.focus(),
      'alt+1': () => set('status', 'open'),
      'alt+2': () => set('status', 'all'),
    },
    [params],
  );
  const alerts = rows.filter((r) => r.alerts.length).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Shipment tracker" subtitle="Click an order to see its lots: booking, invoice, BL, ETA, documents and payment — filled from confirmed documents or by hand." />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="field-input pl-7"
            placeholder="Order, PO, buyer, invoice, BL, vessel…  ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => ['ArrowDown', 'Escape', 'Enter'].includes(e.key) && (e.preventDefault(), e.currentTarget.blur())}
            aria-label="Search lots"
          />
        </div>
        {[
          ['open', 'Open'],
          ['all', 'All'],
        ].map(([k, l], i) => (
          <button key={k} title={`Alt+${i + 1}`} onClick={() => set('status', k)} className={`rounded px-2.5 py-1 text-[12.5px] ${status === k ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {l}
          </button>
        ))}
        <select className="field-input w-auto" value={market} onChange={(e) => set('market', e.target.value)} aria-label="Market">
          <option value="">Gulf + EU</option>
          <option value="GULF">Gulf</option>
          <option value="EU">EU</option>
        </select>
        {alerts > 0 && (
          <span className="flex items-center gap-1 text-[12.5px] font-medium text-amber-700">
            <AlertTriangle className="size-3.5" /> {alerts} lot(s) need attention
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !rows.length ? (
          <Card className="p-8 text-center text-[13px] text-slate-500">No lots. Plan an order's lots first (open the order → Plan shipments → Automatic plan).</Card>
        ) : (
          <OrderGroups
            groups={groupByOrder(rows, (r) => ({ orderId: r.orderId, orderNumber: r.orderNumber, buyer: r.buyer, buyerPoRef: r.buyerPoRef, orderSource: r.orderSource }))}
            summary={(g) => {
              const done = g.items.reduce((a, r) => a + r.docsDone, 0);
              const need = g.items.reduce((a, r) => a + r.docsNeeded, 0);
              const warn = g.items.reduce((a, r) => a + r.alerts.length, 0);
              return (
                <>
                  <Chip>{g.items.length} lot(s)</Chip>
                  <Chip tone="blue">{g.items.filter((r) => r.blStatus === 'RECEIVED' || r.blStatus === 'RELEASED').length} BL in</Chip>
                  <Chip tone={done === need ? 'green' : 'slate'}>
                    documents {done}/{need}
                  </Chip>
                  {warn > 0 && <Chip tone="amber">{warn} alert(s)</Chip>}
                </>
              );
            }}
          >
            {(g) => <LotTable rows={g.items} onOpen={setOpen} />}
          </OrderGroups>
        )}
      </div>
      {open && <LotModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The lots of one order. */
function LotTable({ rows, onOpen }: { rows: TrackRow[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11.5px] text-slate-500">
          <tr>
            {['Lot', 'Size', 'Line · booking', 'Invoice', 'BL', 'Vessel · ETA', 'Docs', 'Payment', ''].map((h) => (
              <th key={h} className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => a.lotNo - b.lotNo)
            .map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer border-t border-slate-100 align-top hover:bg-brand-50">
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <button type="button" className="font-medium text-brand-700 hover:underline">
                    Lot {r.lotNo}
                  </button>
                  <div className="text-[11.5px] text-slate-500">
                    {r.period ?? d(r.targetShipDate)} · {r.market}
                  </div>
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap tabular-nums">
                  {formatAmount(r.quantityMt, 3)} MT
                  <div className="text-[11.5px] text-slate-500">{r.containerCount} × 20'</div>
                </td>
                <td className="px-2.5 py-2">
                  {r.shippingLine ?? '—'}
                  {r.bookingNo && <div className="font-mono text-[11.5px] text-slate-500">{r.bookingNo}</div>}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap">
                  {r.invoiceNumber ?? '—'}
                  {r.invoiceAmount && <div className="text-[11.5px] text-slate-500 tabular-nums">{formatAmount(r.invoiceAmount, 0)}</div>}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <Badge tone={BL_TONE[r.blStatus]}>{r.blStatus.toLowerCase()}</Badge>
                  {r.blNumber && <div className="font-mono text-[11.5px] text-slate-500">{r.blNumber}</div>}
                </td>
                <td className="px-2.5 py-2">
                  {r.vessel ?? '—'}
                  <div className="text-[11.5px] text-slate-500">ETA {d(r.eta)}</div>
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap">
                  <span className={r.docsDone === r.docsNeeded ? 'text-emerald-700' : 'text-slate-600'}>
                    {r.docsDone}/{r.docsNeeded}
                  </span>
                </td>
                <td className="px-2.5 py-2">
                  <Badge tone={PAY_TONE[r.payment]}>{r.payment === 'PART' ? 'part' : r.payment.toLowerCase()}</Badge>
                </td>
                <td className="px-2.5 py-2">
                  {r.alerts.map((a) => (
                    <div key={a} className="flex items-center gap-1 text-[11.5px] whitespace-nowrap text-amber-700">
                      <AlertTriangle className="size-3" /> {a}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

interface CheckItem {
  kind: string;
  label: string;
  required: boolean;
  status: 'PENDING' | 'RECEIVED' | 'NOT_NEEDED';
  fileId: string | null;
  inboxItemId: string | null;
  refNo: string | null;
  docDate: string | null;
}
interface LotDetail {
  lot: Record<string, string | number | null>;
  lines: { id: string; label: string; portName: string | null; quantityMt: string; bags: number; containers: number }[];
  checklist: CheckItem[];
}

const TRACK_FIELDS: { key: string; label: string; type?: 'date' | 'select' }[] = [
  { key: 'shippingLine', label: 'Shipping line' },
  { key: 'bookingNo', label: 'Booking no.' },
  { key: 'vessel', label: 'Vessel / voyage' },
  { key: 'etd', label: 'ETD', type: 'date' },
  { key: 'eta', label: 'ETA', type: 'date' },
  { key: 'invoiceNumber', label: 'Export invoice no.' },
  { key: 'invoiceAmount', label: 'Invoice amount' },
  { key: 'sbNumber', label: 'Shipping bill no.' },
  { key: 'sbDate', label: 'Shipping bill date', type: 'date' },
  { key: 'leoDate', label: 'LEO date', type: 'date' },
  { key: 'blNumber', label: 'BL no.' },
  { key: 'blDate', label: 'BL date', type: 'date' },
  { key: 'blStatus', label: 'BL status', type: 'select' },
];

export function LotModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['lot-docs', id], queryFn: () => api.get<LotDetail>(`/shipments/${id}/documents`) });
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) setF(Object.fromEntries(TRACK_FIELDS.map((t) => [t.key, q.data.lot[t.key] == null ? '' : String(q.data.lot[t.key])])));
  }, [q.data]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lot-docs', id] });
    qc.invalidateQueries({ queryKey: ['tracker'] });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/shipments/${id}/tracking`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])));
      toast.success('Lot saved');
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const mark = async (c: CheckItem, status: CheckItem['status']) => {
    try {
      await api.put(`/shipments/${id}/documents/${c.kind}`, { status, fileId: c.fileId, refNo: c.refNo, docDate: c.docDate });
      refresh();
    } catch (e) {
      showError(e);
    }
  };
  useHotkeys({ 'mod+s, mod+enter': () => save() }, [f], { inModal: true, inInputs: true });
  const lot = q.data?.lot;

  return (
    <Modal
      open
      width="max-w-5xl"
      title={lot ? `Lot ${lot.lotNo} · ${String(lot.quantityMt)} MT · ${lot.containerCount} × 20'` : 'Lot'}
      onClose={onClose}
      footer={
        <>
          {lot && (
            <Link to={`/plan/${String(lot.proformaInvoiceId)}`} className="mr-auto self-center text-[12.5px] text-brand-700 hover:underline">
              Open the order's lots <ExternalLink className="inline size-3" />
            </Link>
          )}
          <Button onClick={onClose} shortcut="esc">
            Close
          </Button>
          {can('sales.shipments', 'edit') && (
            <Button variant="primary" loading={busy} onClick={save} shortcut="mod+s">
              Save tracking
            </Button>
          )}
        </>
      }
    >
      {q.isLoading || !q.data ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            {q.data.lines.length > 0 && (
              <div className="rounded border border-slate-200 p-2 text-[12.5px]">
                {q.data.lines.map((l) => (
                  <div key={l.id} className="flex justify-between gap-2 py-0.5">
                    <span className="truncate">
                      {l.portName ?? '—'} · {l.label}
                    </span>
                    <span className="shrink-0 text-slate-600 tabular-nums">
                      {Number(l.quantityMt)} MT · {l.bags.toLocaleString('en-IN')} bags · {l.containers} ct
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2" onKeyDown={enterNavigation}>
              {TRACK_FIELDS.map((t) => (
                <label key={t.key} className="grid gap-1 text-[12px] font-medium text-slate-600">
                  {t.label}
                  {t.type === 'select' ? (
                    <select data-nav="1" className="field-input" value={f[t.key] ?? 'PENDING'} onChange={(e) => setF((o) => ({ ...o, [t.key]: e.target.value }))}>
                      {BL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input data-nav="1" className="field-input" type={t.type === 'date' ? 'date' : 'text'} value={f[t.key] ?? ''} onChange={(e) => setF((o) => ({ ...o, [t.key]: e.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            <ErrorBox error={error} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                <ClipboardCheck className="size-4 text-emerald-600" /> Documents
              </h3>
              {can('sales.intake', 'create') && (
                <>
                  <Button icon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                    Upload to inbox
                  </Button>
                  <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && uploadToInbox(e.target.files).finally(() => (e.target.value = ''))} />
                </>
              )}
            </div>
            <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-[12.5px]">
              {q.data.checklist.map((c) => (
                <li key={c.kind} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
                  <span className={`size-2 rounded-full ${c.status === 'RECEIVED' ? 'bg-emerald-500' : c.status === 'NOT_NEEDED' ? 'bg-slate-300' : 'bg-amber-400'}`} />
                  <span className="font-medium">{c.label || intakeKind(c.kind).label}</span>
                  {c.refNo && <span className="font-mono text-[11.5px] text-slate-500">{c.refNo}</span>}
                  {c.docDate && <span className="text-[11.5px] text-slate-500">{d(c.docDate)}</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    {c.fileId && (
                      <a href={`/api/files/${c.fileId}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                        Open
                      </a>
                    )}
                    {c.inboxItemId && (
                      <Link to={`/inbox/${c.inboxItemId}`} className="text-slate-500 hover:underline">
                        inbox
                      </Link>
                    )}
                    {can('sales.shipments', 'edit') && (
                      <select className="field-input w-auto py-0.5 text-[12px]" value={c.status} onChange={(e) => mark(c, e.target.value as CheckItem['status'])} aria-label={`${c.label} status`}>
                        <option value="PENDING">Pending</option>
                        <option value="RECEIVED">Received</option>
                        <option value="NOT_NEEDED">Not needed</option>
                      </select>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-slate-500">Confirming a document in the inbox ticks it here automatically, with the file attached.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
