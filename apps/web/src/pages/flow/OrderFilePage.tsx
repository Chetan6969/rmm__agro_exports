/**
 * One order's file: everything about one PO / PI and nothing about the others.
 * Tabs: Lots · Documents (a folder for the order and one per lot) · Plan & packaging · Freight & payments.
 */
import { formatAmount, PURCHASE_CATEGORIES } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, FileText, FileUp, Folder, FolderOpen, MailSearch, Pencil, Plus } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AutoPlanPanel } from '../../components/AutoPlanPanel';
import { Chip } from '../../components/OrderGroups';
import { PurchaseInvoiceModal, PurchaseOrderModal, type PurchaseInvoiceRow } from '../../components/PurchaseForms';
import { Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { STATUS_LABEL, STATUS_TONE, uploadToInbox } from './InboxPage';
import { NEXT_STEP, type FileRef, type MadeDoc, type OrderFile, type OrderLot } from './orderTypes';
import { BillTable } from './PurchaseInvoicesPage';
import { LotModal } from './TrackerPage';

const TABS = [
  { key: 'lots', label: 'Lots' },
  { key: 'documents', label: 'Documents' },
  { key: 'plan', label: 'Plan & packaging' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'money', label: 'Freight & payments' },
];
const day = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

export function OrderFilePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'lots';
  const q = useQuery({
    queryKey: ['order-file', id],
    queryFn: () => api.get<OrderFile>(`/order-files/${id}`),
    // keep refreshing while a just-uploaded document is still being read
    refetchInterval: (query) => (query.state.data?.folders.toReview.some((f) => f.status === 'QUEUED' || f.status === 'READING') ? 2500 : false),
  });
  const [lotOpen, setLotOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const into = useRef<{ orderId?: string; shipmentId?: string }>({});
  const setTab = (t: string) => setParams(t === 'lots' ? {} : { tab: t }, { replace: true });
  const refresh = () => qc.invalidateQueries({ queryKey: ['order-file', id] });
  const canUpload = can('sales.intake', 'create');

  const choose = (target: { orderId?: string; shipmentId?: string }) => {
    into.current = target;
    fileRef.current?.click();
  };
  const upload = async (list: FileList) => {
    try {
      await uploadToInbox(list, into.current);
      refresh();
    } catch (e) {
      showError(e);
    }
  };

  useHotkeys(
    {
      ...Object.fromEntries(TABS.map((t, i) => [`alt+${i + 1}`, () => setTab(t.key)])),

      'alt+u': () => canUpload && choose({ orderId: id }),
      esc: () => navigate('/orders'),
    },
    [id, tab],
    { enabled: !lotOpen },
  );

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const { order, progress: p, lots, folders } = q.data;
  const step = NEXT_STEP[p.next];
  const planned = p.lots > 0 && p.plannedMt + 0.001 >= Number(order.totalMt);
  const steps = [
    { label: 'Order', done: Number(order.totalMt) > 0, value: `${formatAmount(order.totalMt, 3)} MT`, tab: 'lots' },
    { label: 'Lots planned', done: planned, value: p.lots ? `${p.lots} lot(s)` : 'not yet', tab: 'plan' },
    { label: 'Packaging', done: p.packagingLines > 0 && p.packagingToOrder === 0, value: p.packagingLines ? (p.packagingToOrder ? `${p.packagingToOrder} to order` : 'ordered') : 'not yet', tab: 'plan' },
    { label: 'Shipped', done: p.lots > 0 && p.shipped === p.lots, value: `${p.shipped} / ${p.lots}`, tab: 'lots' },
    { label: 'Documents', done: p.docsNeeded > 0 && p.docsDone >= p.docsNeeded, value: `${p.docsDone} / ${p.docsNeeded}`, tab: 'documents' },
    { label: 'Payment', done: p.invoiced > 0 && p.received + 0.5 >= p.invoiced, value: p.invoiced ? `${formatAmount(String(p.received), 0)} / ${formatAmount(String(p.invoiced), 0)}` : '—', tab: 'money' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" tabIndex={-1} onClick={() => navigate('/orders')} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label="All orders">
              <ArrowLeft className="size-4" />
            </button>
            <span className="font-mono">{order.number}</span>
            <Chip tone={order.orderSource === 'Our PI' ? 'slate' : 'blue'}>{order.orderSource === 'Our PI' ? 'Our PI' : 'Buyer PO'}</Chip>
          </span>
        }
        subtitle={[order.buyer, order.buyerPoRef && `PO ${order.buyerPoRef}`, order.lcNumber && `LC ${order.lcNumber}`, `${order.currency ?? ''} ${formatAmount(order.amount, 0)}`, `dated ${day(order.date)}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button icon={<Pencil className="size-3.5" />} onClick={() => navigate(`/d/proformaInvoices/${id}`)}>
              Edit / print order
            </Button>
            {canUpload && (
              <Button variant="primary" icon={<FileUp className="size-3.5" />} onClick={() => choose({ orderId: id })} shortcut="alt+u">
                Upload to this order
              </Button>
            )}
          </>
        }
      />
      <input ref={fileRef} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,.xlsx,.xls,.docx,.doc,.txt" onChange={(e) => e.target.files && upload(e.target.files).finally(() => (e.target.value = ''))} />

      {/* where the order stands */}
      <div className="border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {steps.map((s, i) => (
            <li key={s.label}>
              <button type="button" onClick={() => setTab(s.tab)} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${s.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${s.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{s.done ? <Check className="size-3" /> : i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-slate-800">{s.label}</span>
                  <span className="block truncate text-[11.5px] text-slate-500">{s.value}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-slate-500">Next:</span>
          <Chip tone={step.tone}>{step.label}</Chip>
          <span className="text-slate-600">{step.help}</span>
          {p.next !== 'DONE' && p.next !== 'CANCELLED' && (
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setTab(step.tab)}>
              Go there →
            </button>
          )}
        </div>
        {p.alerts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {p.alerts.map((a) => (
              <span key={a} className="flex items-center gap-1 text-[12px] text-amber-700">
                <AlertTriangle className="size-3" /> {a}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200 bg-white px-3 sm:px-5" role="tablist">
        {TABS.map((t, i) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} title={`Alt+${i + 1}`} onClick={() => setTab(t.key)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${tab === t.key ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {t.label}
            {t.key === 'lots' && lots.length > 0 && <span className="ml-1 text-[11.5px] text-slate-400">{lots.length}</span>}
            {t.key === 'documents' && folders.toReview.length > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] text-white">{folders.toReview.length}</span>}
          </button>
        ))}
        <span className="ml-auto self-center text-[11.5px] text-slate-400 max-md:hidden">Alt+1–5 tabs · Esc all orders</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3 sm:p-5">
        {tab === 'lots' && <Lots lots={lots} onOpen={setLotOpen} onPlan={() => setTab('plan')} />}
        {tab === 'documents' && <Documents data={q.data} orderId={id} onUpload={canUpload ? choose : undefined} onLot={setLotOpen} />}
        {tab === 'plan' && <AutoPlanPanel piId={id} onChanged={refresh} />}
        {tab === 'purchases' && <Purchases data={q.data} orderId={id} onChanged={refresh} />}
        {tab === 'money' && <Money data={q.data} />}
      </div>
      {lotOpen && (
        <LotModal
          id={lotOpen}
          onClose={() => {
            setLotOpen(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Lots({ lots, onOpen, onPlan }: { lots: OrderLot[]; onOpen: (id: string) => void; onPlan: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState(0);
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  useHotkeys(
    {
      arrowdown: () => setSel((i) => Math.min(i + 1, lots.length - 1)),
      arrowup: () => setSel((i) => Math.max(i - 1, 0)),
      'enter, arrowright, arrowleft': () => lots[sel] && toggle(lots[sel].id),
      'alt+o': () => lots[sel] && onOpen(lots[sel].id),
    },
    [lots, sel],
  );
  if (!lots.length) {
    return (
      <Card className="p-8 text-center text-[13px] text-slate-500">
        This order has no lots yet.{' '}
        <button type="button" className="font-medium text-brand-700 underline" onClick={onPlan}>
          Plan them automatically
        </button>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {lots.map((l, i) => {
        const required = l.checklist.filter((c) => c.required);
        const done = required.filter((c) => c.status !== 'PENDING').length;
        const expanded = open.has(l.id);
        return (
          <section key={l.id} className={`overflow-hidden rounded-lg border bg-white ${i === sel ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-slate-200'}`}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => {
                setSel(i);
                toggle(l.id);
              }}
              className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-[13px] hover:bg-slate-50 md:grid-cols-[auto_130px_150px_170px_1fr_110px]"
            >
              {expanded ? <ChevronDown className="size-4 text-slate-500" /> : <ChevronRight className="size-4 text-slate-400" />}
              <span className="font-semibold text-slate-900">
                Lot {l.lotNo} <Chip tone={l.status === 'SHIPPED' ? 'green' : l.status === 'CANCELLED' ? 'red' : l.status === 'IN_PROGRESS' ? 'blue' : 'slate'}>{l.status.toLowerCase().replace('_', ' ')}</Chip>
              </span>
              <span className="tabular-nums max-md:col-start-2">
                {formatAmount(l.quantityMt, 3)} MT · {l.containerCount} × 20'
              </span>
              <span className="text-slate-600 max-md:col-start-2">{l.period ?? `ship ${day(l.targetShipDate)}`}</span>
              <span className="truncate text-slate-500 max-md:col-start-2">{[l.invoiceNumber, l.blNumber && `BL ${l.blNumber}`, l.vessel].filter(Boolean).join(' · ') || 'not booked yet'}</span>
              <span className={`text-right text-[12.5px] max-md:col-start-2 max-md:text-left ${done === required.length ? 'text-emerald-700' : 'text-slate-600'}`}>
                documents {done}/{required.length}
              </span>
            </button>
            {expanded && (
              <div className="space-y-3 border-t border-slate-200 bg-slate-50 p-3 text-[12.5px]">
                {l.lines.length > 0 && (
                  <table className="w-full rounded border border-slate-200 bg-white">
                    <tbody>
                      {l.lines.map((x) => (
                        <tr key={x.id} className="border-t border-slate-100 first:border-t-0">
                          <td className="px-2.5 py-1">{x.portName ?? '—'}</td>
                          <td className="px-2.5 py-1">{x.label}</td>
                          <td className="px-2.5 py-1 text-right tabular-nums">{Number(x.quantityMt)} MT</td>
                          <td className="px-2.5 py-1 text-right tabular-nums">{x.bags.toLocaleString('en-IN')} bags</td>
                          <td className="px-2.5 py-1 text-right tabular-nums">{x.containers} ct</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {l.checklist.map((c) => (
                    <Chip key={c.kind} tone={c.status === 'RECEIVED' ? 'green' : c.status === 'NOT_NEEDED' ? 'slate' : 'amber'}>
                      {c.status === 'RECEIVED' ? '✓ ' : ''}
                      {c.label}
                    </Chip>
                  ))}
                </div>
                <Button variant="primary" onClick={() => onOpen(l.id)} shortcut="alt+o">
                  Open lot (booking, BL, documents)
                </Button>
              </div>
            )}
          </section>
        );
      })}
      <div className="text-[12px] text-slate-400 max-md:hidden">↑ ↓ choose a lot · Enter open / close · Alt+O booking, BL and documents of the lot</div>
    </div>
  );
}

/** Folders: first what needs checking, then the order's own papers, then one folder per lot. */
function Documents({ data, orderId, onUpload, onLot }: { data: OrderFile; orderId: string; onUpload?: (t: { orderId?: string; shipmentId?: string }) => void; onLot: (id: string) => void }) {
  const { folders, lots, vendorPos } = data;
  const orderFiles = folders.orderPapers.length + folders.documents.length;
  return (
    <div className="space-y-2">
      {folders.toReview.length > 0 && (
        <FolderBox title="To check (read from your uploads)" count={`${folders.toReview.length}`} tone="amber" defaultOpen>
          <FileList files={folders.toReview} lots={lots} />
        </FolderBox>
      )}
      <FolderBox title="Order papers — PO / PI, LC, contract" count={`${orderFiles} file(s)`} defaultOpen={orderFiles > 0} action={onUpload && <Button icon={<FileUp className="size-3.5" />} onClick={() => onUpload({ orderId })}>Upload here</Button>}>
        {orderFiles === 0 ? <Empty>No order papers yet.</Empty> : null}
        <FileList files={folders.orderPapers} />
        <MadeList docs={folders.documents} />
      </FolderBox>
      {vendorPos.length > 0 && (
        <FolderBox title="Purchase orders (to suppliers)" count={`${vendorPos.length}`}>
          <PoList pos={vendorPos} />
        </FolderBox>
      )}
      {data.purchaseInvoices.length > 0 && (
        <FolderBox title="Purchase invoices (supplier bills)" count={`${data.purchaseInvoices.length}`}>
          <BillTable rows={data.purchaseInvoices} />
        </FolderBox>
      )}
      {lots.map((l) => {
        const missing = l.checklist.filter((c) => c.required && c.status === 'PENDING');
        const need = l.checklist.filter((c) => c.required).length;
        // documents ticked by hand with a file attached, besides what came through the inbox
        const inboxFiles = new Set(l.files.map((f) => f.fileId));
        const attached = l.checklist.filter((c) => c.fileId && !inboxFiles.has(c.fileId));
        return (
          <FolderBox
            key={l.id}
            title={`Lot ${l.lotNo} — ${Number(l.quantityMt)} MT${l.invoiceNumber ? ` · ${l.invoiceNumber}` : ''}`}
            count={`${need - missing.length}/${need} documents`}
            tone={missing.length === 0 ? 'green' : 'slate'}
            action={
              <>
                <Button onClick={() => onLot(l.id)}>Checklist</Button>
                {onUpload && (
                  <Button icon={<FileUp className="size-3.5" />} onClick={() => onUpload({ shipmentId: l.id })}>
                    Upload here
                  </Button>
                )}
              </>
            }
          >
            <FileList files={l.files} />
            {attached.length > 0 && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {attached.map((c) => (
                  <li key={c.kind} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
                    <FileText className="size-4 text-slate-400" />
                    <a className="text-brand-700 hover:underline" href={`/api/files/${c.fileId}`} target="_blank" rel="noreferrer">
                      {c.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <MadeList docs={l.documents} />
            {missing.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-[12px] text-slate-500">
                Still missing:
                {missing.map((c) => (
                  <Chip key={c.kind} tone="amber">
                    {c.label}
                  </Chip>
                ))}
              </div>
            )}
          </FolderBox>
        );
      })}
      {!lots.length && <Empty>Lot folders appear once the lots are planned.</Empty>}
    </div>
  );
}

function FolderBox({ title, count, tone = 'slate', action, defaultOpen = false, children }: { title: string; count: string; tone?: 'slate' | 'amber' | 'green'; action?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <FolderOpen className="size-4 shrink-0 text-amber-500" /> : <Folder className="size-4 shrink-0 text-amber-500" />}
          <span className="truncate text-[13px] font-semibold text-slate-800">{title}</span>
          <Chip tone={tone}>{count}</Chip>
        </button>
        {action}
      </div>
      {open && <div className="border-t border-slate-200">{children}</div>}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <div className="px-3 py-3 text-[12.5px] text-slate-400">{children}</div>;

function FileList({ files, lots }: { files: FileRef[]; lots?: OrderLot[] }) {
  if (!files.length) return null;
  return (
    <ul className="divide-y divide-slate-100">
      {files.map((f) => {
        const lot = lots?.find((l) => l.id === f.shipmentId);
        return (
          <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-[13px]">
            <FileText className="size-4 text-slate-400" />
            <span className="w-44 shrink-0 truncate font-medium text-slate-800">{f.label}</span>
            <a className="min-w-0 flex-1 truncate text-brand-700 hover:underline" href={`/api/files/${f.fileId}`} target="_blank" rel="noreferrer">
              {f.fileName}
            </a>
            {lot && <Chip>Lot {lot.lotNo}</Chip>}
            {f.status !== 'CONFIRMED' && <Chip tone={STATUS_TONE[f.status] === 'amber' ? 'amber' : STATUS_TONE[f.status] === 'red' ? 'red' : 'blue'}>{STATUS_LABEL[f.status] ?? f.status}</Chip>}
            <Link to={`/inbox/${f.id}`} className="text-[12px] font-medium text-slate-600 hover:underline">
              {f.status === 'CONFIRMED' ? 'details' : 'Check & confirm'}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MadeList({ docs }: { docs: MadeDoc[] }) {
  if (!docs.length) return null;
  return (
    <ul className="divide-y divide-slate-100 border-t border-slate-100">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-[13px]">
          <FileText className="size-4 text-emerald-600" />
          <span className="w-44 shrink-0 truncate font-medium text-slate-800">{d.label}</span>
          <Link className="font-mono text-brand-700 hover:underline" to={`/d/${d.key}/${d.id}`}>
            {d.number}
          </Link>
          <span className="text-slate-500">{day(d.date)}</span>
          <Chip>{d.status.toLowerCase()}</Chip>
          <a className="ml-auto text-[12px] font-medium text-slate-600 hover:underline" href={`/api/documents/${d.key}/${d.id}/pdf`} target="_blank" rel="noreferrer">
            PDF
          </a>
        </li>
      ))}
    </ul>
  );
}

function PoList({ pos }: { pos: OrderFile['vendorPos'] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {pos.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-[13px]">
          <FileText className="size-4 text-slate-400" />
          <a className="font-mono font-medium text-brand-700 hover:underline" href={`/api/vendor-pos/${v.id}/pdf`} target="_blank" rel="noreferrer">
            {v.number}
          </a>
          <span>{v.supplierName}</span>
          <Chip>{PURCHASE_CATEGORIES[v.category]}</Chip>
          <span className="text-slate-500">
            {v.items} item(s) · ₹{formatAmount(v.totalAmount, 2)} · billed ₹{formatAmount(v.billedAmount, 2)}
          </span>
          <span className="ml-auto">
            <Chip tone={v.status === 'RECEIVED' ? 'green' : v.status === 'CANCELLED' ? 'red' : 'blue'}>{v.status.toLowerCase()}</Chip>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Buying for this order: our purchase orders in one block, the suppliers' invoices in another. */
function Purchases({ data, orderId, onChanged }: { data: OrderFile; orderId: string; onChanged: () => void }) {
  const { can } = useSession();
  const [adding, setAdding] = useState<'po' | 'bill' | null>(null);
  const [edit, setEdit] = useState<PurchaseInvoiceRow | null>(null);
  const ref = { id: orderId, label: data.order.number };
  const bills = data.purchaseInvoices;
  const total = bills.reduce((s, b) => s + Number(b.totalAmount), 0);
  const owed = total - bills.reduce((s, b) => s + Number(b.paidAmount), 0);
  useHotkeys({ 'alt+o': () => can('sales.vendorPos', 'create') && setAdding('po'), 'alt+i': () => can('sales.purchaseInvoices', 'create') && setAdding('bill') }, []);
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-[13.5px] font-semibold text-slate-800">Purchase orders — what we ordered from suppliers</h2>
          <Chip>{data.vendorPos.length}</Chip>
          {can('sales.vendorPos', 'create') && (
            <span className="ml-auto">
              <Button icon={<Plus className="size-3.5" />} onClick={() => setAdding('po')} shortcut="alt+o">
                New purchase order
              </Button>
            </span>
          )}
        </div>
        {data.vendorPos.length ? <PoList pos={data.vendorPos} /> : <Empty>No purchase order for this order yet.</Empty>}
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <h2 className="text-[13.5px] font-semibold text-slate-800">Purchase invoices — bills the suppliers sent</h2>
          <Chip>{bills.length}</Chip>
          {bills.length > 0 && (
            <Chip tone={owed > 0.005 ? 'amber' : 'green'}>
              ₹{formatAmount(String(total), 2)} billed · {owed > 0.005 ? `₹${formatAmount(String(owed), 2)} to pay` : 'all paid'}
            </Chip>
          )}
          {can('sales.purchaseInvoices', 'create') && (
            <span className="ml-auto">
              <Button icon={<Plus className="size-3.5" />} onClick={() => setAdding('bill')} shortcut="alt+i">
                New purchase invoice
              </Button>
            </span>
          )}
        </div>
        {bills.length ? <BillTable rows={bills} onEdit={can('sales.purchaseInvoices', 'edit') ? setEdit : undefined} /> : <Empty>No supplier bill for this order yet. Upload it (Upload to this order) or enter it here.</Empty>}
      </Card>
      {adding === 'po' && <PurchaseOrderModal order={ref} onClose={() => setAdding(null)} onSaved={onChanged} />}
      {adding === 'bill' && <PurchaseInvoiceModal order={ref} onClose={() => setAdding(null)} onSaved={onChanged} />}
      {edit && <PurchaseInvoiceModal row={edit} onClose={() => setEdit(null)} onSaved={onChanged} />}
    </div>
  );
}

function Money({ data }: { data: OrderFile }) {
  const { can } = useSession();
  const { freight, payments, lots, progress: p, order } = data;
  const lotNo = (id: string | null) => lots.find((l) => l.id === id)?.lotNo;
  const open = lots.filter((l) => l.status === 'PLANNED' || l.status === 'IN_PROGRESS');
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          <MailSearch className="size-4 text-slate-500" />
          <h2 className="text-[13.5px] font-semibold text-slate-800">Freight quotations</h2>
        </div>
        {!freight.length && <Empty>No freight enquiry for this order yet.</Empty>}
        <ul className="divide-y divide-slate-100">
          {freight.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[13px]">
              <Link to={`/freight/${f.id}`} className="font-mono font-medium text-brand-700 hover:underline">
                {f.number}
              </Link>
              {lotNo(f.shipmentId) && <Chip>Lot {lotNo(f.shipmentId)}</Chip>}
              <span className="text-slate-600">
                {f.portOfLoading} → {f.portOfDischarge} · {f.containerCount} ct
              </span>
              <span className="ml-auto">
                <Chip tone={f.status === 'AWARDED' ? 'green' : 'slate'}>{f.awardedTo ? `booked ${f.awardedTo}` : f.status.toLowerCase()}</Chip>
              </span>
            </li>
          ))}
        </ul>
        {can('sales.freight', 'create') && open.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-[12.5px]">
            Get quotes for:
            {open.map((l) => (
              <Link key={l.id} to={`/freight/new?shipment=${l.id}`} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-brand-700 hover:border-brand-600">
                Lot {l.lotNo}
              </Link>
            ))}
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-3 py-2">
          <h2 className="text-[13.5px] font-semibold text-slate-800">Payments</h2>
          <div className="text-[12px] text-slate-500">
            Invoiced {order.currency} {formatAmount(String(p.invoiced), 2)} · received {formatAmount(String(p.received), 2)}
          </div>
        </div>
        {!payments.length && <Empty>No receipt recorded. Receipts are added on the commercial invoice.</Empty>}
        <ul className="divide-y divide-slate-100">
          {payments.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
              <span className="text-slate-500">{day(r.date)}</span>
              <span className="font-medium tabular-nums">{formatAmount(r.amount, 2)}</span>
              <span className="text-slate-500">{[r.mode, r.reference].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
