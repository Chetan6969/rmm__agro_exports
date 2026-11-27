/**
 * Review one inbox document: the original on the left, what was read from it on the right.
 * Every value shows how sure the reader is and the words it came from; the person fixes what is
 * wrong, picks the order / lot, and confirms. Corrections are remembered for this document layout.
 */
import { INTAKE_KINDS, intakeKind, PURCHASE_CATEGORIES, PURCHASE_CATEGORY_KEYS, type Extracted, type ExtractedLine, type PurchaseCategory } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronRight, EyeOff, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { enterNavigation } from '../../components/EntityForm';
import { ConfirmDialog } from '../../components/Modal';
import { RefSelect } from '../../components/RefSelect';
import { Badge, Button, ErrorBox, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { STATUS_LABEL, STATUS_TONE } from './InboxPage';

interface Ref {
  id: string;
  label: string;
}
interface Lot {
  id: string;
  lotNo: number;
  quantityMt: string;
  containerCount: number;
  period: string | null;
  invoiceNumber: string | null;
  blNumber: string | null;
  status: string;
}
interface Item {
  id: string;
  fileId: string;
  fileName: string;
  fileKind: string;
  sourcePath: string | null;
  status: string;
  kind: string | null;
  kindConfidence: string | null;
  readMethod: string | null;
  ocrConfidence: number | null;
  pages: number | null;
  text: string | null;
  fields: Record<string, Extracted> | null;
  lines: ExtractedLine[] | null;
  refs: Record<string, string[]> | null;
  orderId: string | null;
  shipmentId: string | null;
  result: string | null;
  error: string | null;
  action: string;
  order: { id: string; number: string; buyerPoRef: string | null; buyer: string | null } | null;
  lots: Lot[];
  suggestBuy: { supplier: Ref | null; vendorPo: Ref | null } | null;
  suggest: {
    buyer: Ref | null;
    currency: (Ref & { rate: string }) | null;
    portOfLoading: Ref | null;
    portOfDischarge: Ref | null;
    lines: { port: Ref | null; packing: Ref | null; product: Ref | null }[];
  } | null;
}

const tone = (c: number | undefined) => (c === undefined ? 'text-slate-300' : c >= 0.8 ? 'text-emerald-600' : c >= 0.5 ? 'text-amber-500' : 'text-red-500');
const dot = (c: number | undefined, title: string) => <span title={title} className={`text-[10px] ${tone(c)}`}>●</span>;

export function InboxReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({
    queryKey: ['inbox', 'item', id],
    queryFn: () => api.get<Item>(`/intake/${id}`),
    refetchInterval: (query) => (query.state.data && ['QUEUED', 'READING'].includes(query.state.data.status) ? 2000 : false),
  });
  const next = useQuery({ queryKey: ['inbox', 'next', id], queryFn: () => api.get<{ rows: { id: string }[] }>(`/intake${qs({ status: 'TO_REVIEW' })}`) });
  const item = q.data;

  const [kind, setKind] = useState('other');
  const [values, setValues] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<Ref | null>(null);
  const [lotId, setLotId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [del, setDel] = useState(false);
  const [supplier, setSupplier] = useState<Ref | null>(null);
  const [category, setCategory] = useState<PurchaseCategory>('PACKAGING');
  const [poId, setPoId] = useState('');
  const [view, setView] = useState<'original' | 'text'>('original');
  const formRef = useRef<HTMLDivElement>(null);
  const loadedFor = useRef<string | null>(null);

  // start the form from what was read (once per document version)
  useEffect(() => {
    if (!item || ['QUEUED', 'READING'].includes(item.status)) return;
    const stamp = `${item.id}:${item.kind}:${item.status}`;
    if (loadedFor.current === stamp) return;
    loadedFor.current = stamp;
    setKind(item.kind ?? 'other');
    setValues(Object.fromEntries(Object.entries(item.fields ?? {}).map(([k, v]) => [k, v.value])));
    setOrder(item.order ? { id: item.order.id, label: item.order.number } : null);
    setLotId(item.shipmentId);
    setSupplier(item.suggestBuy?.supplier ?? null);
    setPoId(item.suggestBuy?.vendorPo?.id ?? '');
  }, [item]);

  const lots = useQuery({ queryKey: ['inbox', 'lots', order?.id], queryFn: () => api.get<Lot[]>(`/intake/lots${qs({ orderId: order?.id })}`), enabled: !!order?.id });
  const def = intakeKind(kind);
  const action = def.action;
  const buying = action === 'purchase' || action === 'vendor-po';
  const supplierPos = useQuery({
    queryKey: ['vendor-pos', 'for-bill', supplier?.label ?? ''],
    queryFn: () => api.get<{ id: string; number: string; supplierName: string | null; totalAmount: string }[]>(`/vendor-pos${qs({ search: supplier?.label })}`),
    enabled: action === 'purchase' && !!supplier && can('sales.vendorPos', 'view'),
  });
  const done = item?.status === 'CONFIRMED';
  const nextId = useMemo(() => next.data?.rows.find((r) => r.id !== id)?.id ?? null, [next.data, id]);

  const confirm = async () => {
    if (!item || done) return;
    setBusy('confirm');
    setError(null);
    try {
      const body: Record<string, unknown> = { kind, fields: values, orderId: order?.id ?? null, shipmentId: lotId };
      if (buying) body.purchase = { supplierId: supplier?.id ?? null, category, vendorPoId: action === 'purchase' ? poId || null : null };
      if (action === 'order') {
        // keep the checked values, then make the order in the full Orders / PIs form
        await api.post(`/intake/${id}/checked`, { kind, fields: values });
        qc.invalidateQueries({ queryKey: ['inbox'] });
        navigate(`/d/proformaInvoices/new?intake=${id}`);
        return;
      }
      const r = await api.post<{ result: string; learned: number }>(`/intake/${id}/confirm`, body);
      toast.success('Confirmed', { description: `${r.result.startsWith('order:') ? 'Order saved.' : r.result.startsWith('lot:') ? 'Lot updated.' : r.result.startsWith('purchase-invoice:') ? 'Purchase invoice entered.' : r.result.startsWith('purchase-order:') ? 'Filed with the purchase order.' : 'Filed.'}${r.learned ? ` ${r.learned} correction(s) remembered for this layout.` : ''}` });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      if (nextId) navigate(`/inbox/${nextId}`);
      else navigate('/inbox');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const changeKind = async (k: string) => {
    setKind(k);
    if (!item || done || k === item.kind) return;
    setBusy('reread');
    try {
      await api.post(`/intake/${id}/reread`, { kind: k });
      loadedFor.current = null;
      await qc.invalidateQueries({ queryKey: ['inbox', 'item', id] });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  const ignore = async () => {
    try {
      const r = await api.post<{ status: string }>(`/intake/${id}/ignore`);
      toast.success(r.status === 'IGNORED' ? 'Ignored — kept in the inbox under "Ignored"' : 'Back to review');
      qc.invalidateQueries({ queryKey: ['inbox'] });
      if (r.status === 'IGNORED') navigate(nextId ? `/inbox/${nextId}` : '/inbox');
    } catch (e) {
      showError(e);
    }
  };

  useHotkeys(
    {
      'mod+enter': () => confirm(),
      'alt+i': () => ignore(),
      'alt+arrowright, alt+n': () => nextId && navigate(`/inbox/${nextId}`),
      'alt+t': () => setView((v) => (v === 'text' ? 'original' : 'text')),
      esc: () => navigate('/inbox'),
    },
    [values, kind, order, lotId, nextId, item, supplier, category, poId],
    { inInputs: true },
  );

  if (q.isLoading) return <Spinner />;
  if (q.error || !item) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const reading = ['QUEUED', 'READING'].includes(item.status);
  const fileUrl = `/api/files/${item.fileId}`;
  const setV = (k: string, v: string) => setValues((o) => ({ ...o, [k]: v }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <button type="button" onClick={() => navigate('/inbox')} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Back to the inbox">
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-slate-900" title={item.sourcePath ?? item.fileName}>
            {item.fileName}
          </h1>
          <div className="text-[12px] text-slate-500">
            {item.readMethod === 'ocr' ? 'Read by OCR' : item.readMethod === 'mixed' ? 'Text + OCR' : item.readMethod === 'text' ? 'Read from its text' : '—'}
            {item.ocrConfidence != null && ` · OCR ${item.ocrConfidence}%`}
            {item.pages ? ` · ${item.pages} page(s)` : ''}
            {item.sourcePath && ` · ${item.sourcePath}`}
          </div>
        </div>
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {!done && can('sales.intake', 'edit') && (
            <Button icon={<EyeOff className="size-3.5" />} onClick={ignore} shortcut="alt+i">
              {item.status === 'IGNORED' ? 'Un-ignore' : 'Ignore'}
            </Button>
          )}
          {nextId && (
            <Button icon={<ChevronRight className="size-3.5" />} onClick={() => navigate(`/inbox/${nextId}`)} shortcut="alt+n">
              Next
            </Button>
          )}
          {can('sales.intake', 'delete') && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(true)} aria-label="Delete" />}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* original */}
        <div className="flex min-h-[50vh] flex-col border-r border-slate-200 bg-slate-100">
          <div className="flex gap-1 border-b border-slate-200 bg-white px-2 py-1 text-[12.5px]">
            {(['original', 'text'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`rounded px-2 py-0.5 ${view === v ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {v === 'original' ? 'Original' : 'Text read'}
              </button>
            ))}
            <span className="ml-auto self-center text-[11.5px] text-slate-400">Alt+T switches</span>
          </div>
          {view === 'text' || !['pdf', 'image'].includes(item.fileKind) ? (
            <pre className="min-h-0 flex-1 overflow-auto bg-white p-3 font-mono text-[11.5px] whitespace-pre-wrap text-slate-700">{item.text || '(nothing read yet)'}</pre>
          ) : item.fileKind === 'pdf' ? (
            <iframe title="Original document" src={`${fileUrl}#view=FitH`} className="min-h-0 w-full flex-1 bg-white" />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <img src={fileUrl} alt={item.fileName} className="mx-auto max-w-full bg-white shadow" />
            </div>
          )}
        </div>

        {/* read data */}
        <div ref={formRef} onKeyDown={enterNavigation} className="min-h-0 space-y-4 overflow-auto p-4">
          {reading ? (
            <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-4 text-[13px] text-sky-800">
              <RefreshCw className="size-4 animate-spin" /> Reading the document on the server{item.fileKind === 'pdf' || item.fileKind === 'image' ? ' (scans take a few seconds a page)' : ''}…
            </div>
          ) : (
            <>
              {item.error && <ErrorBox error={new Error(item.error)} />}
              {done && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
                  Confirmed.{' '}
                  {item.result?.startsWith('order:') && (
                    <Link className="font-medium underline" to={`/orders/${item.result.slice(6)}`}>
                      Open the order file
                    </Link>
                  )}
                  {item.result?.startsWith('purchase-invoice:') && (
                    <Link className="font-medium underline" to={item.orderId ? `/orders/${item.orderId}?tab=purchases` : '/purchase-invoices'}>
                      Open the purchase invoice
                    </Link>
                  )}
                  {item.result?.startsWith('purchase-order:') && (
                    <Link className="font-medium underline" to={item.orderId ? `/orders/${item.orderId}?tab=purchases` : '/purchase-orders'}>
                      Open the purchase order
                    </Link>
                  )}
                  {item.result?.startsWith('lot:') && item.orderId && (
                    <Link className="font-medium underline" to={`/orders/${item.orderId}?tab=documents`}>
                      Open the order file
                    </Link>
                  )}
                </div>
              )}

              <Field label="This document is" hint={item.kindConfidence && !done ? `${Math.round(Number(item.kindConfidence) * 100)}% sure` : undefined}>
                <select data-nav="1" className="field-input" value={kind} disabled={done || busy === 'reread'} onChange={(e) => changeKind(e.target.value)}>
                  {INTAKE_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Field>

              {/* where it goes */}
              {action !== 'order' && action !== 'none' && (
                <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <h2 className="text-[13px] font-semibold text-slate-800">Belongs to</h2>
                  <Field label="Order">
                    <RefSelect
                      entity="proformaInvoices"
                      source="document"
                      value={order?.id ?? null}
                      label={order?.label ?? null}
                      disabled={done}
                      placeholder="Search order / PI no.…"
                      onChange={(oid, l) => {
                        setOrder(oid ? { id: oid, label: l ?? '' } : null);
                        setLotId(null);
                      }}
                    />
                  </Field>
                  {(action === 'lot' || action === 'lot-doc') && (
                    <Field label="Shipment lot" hint={!order ? 'Choose the order first' : undefined}>
                      <select data-nav="1" className="field-input" value={lotId ?? ''} disabled={done || !order} onChange={(e) => setLotId(e.target.value || null)}>
                        <option value="">— choose the lot —</option>
                        {(lots.data ?? item.lots).map((l) => (
                          <option key={l.id} value={l.id}>
                            Lot {l.lotNo} · {Number(l.quantityMt)} MT · {l.containerCount} ct{l.period ? ` · ${l.period}` : ''}
                            {l.invoiceNumber ? ` · ${l.invoiceNumber}` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {item.refs && Object.values(item.refs).some((x) => x.length) && (
                    <p className="text-[11.5px] text-slate-500">
                      Numbers found:{' '}
                      {Object.values(item.refs)
                        .flat()
                        .slice(0, 8)
                        .join(', ')}
                    </p>
                  )}
                </section>
              )}

              {buying && (
                <section className="space-y-2 rounded-lg border border-violet-200 bg-white p-3">
                  <h2 className="text-[13px] font-semibold text-slate-800">{action === 'purchase' ? 'Purchase invoice — supplier’s bill to us' : 'Our purchase order to a supplier'}</h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Supplier" hint={values.supplierName || values.vendorName ? `read: ${values.supplierName || values.vendorName}` : undefined}>
                      <RefSelect
                        entity="suppliers"
                        value={supplier?.id ?? null}
                        label={supplier?.label ?? null}
                        allowCreate
                        disabled={done}
                        onChange={(sid, l) => {
                          setSupplier(sid ? { id: sid, label: l ?? '' } : null);
                          setPoId('');
                        }}
                      />
                    </Field>
                    <Field label="For">
                      <select data-nav="1" className="field-input" value={category} disabled={done} onChange={(e) => setCategory(e.target.value as PurchaseCategory)}>
                        {PURCHASE_CATEGORY_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {PURCHASE_CATEGORIES[k]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {action === 'purchase' && (
                      <Field label="Against purchase order">
                        <select data-nav="1" className="field-input" value={poId} disabled={done || !supplier} onChange={(e) => setPoId(e.target.value)}>
                          <option value="">— none —</option>
                          {item.suggestBuy?.vendorPo && !(supplierPos.data ?? []).some((p) => p.id === item.suggestBuy!.vendorPo!.id) && <option value={item.suggestBuy.vendorPo.id}>{item.suggestBuy.vendorPo.label}</option>}
                          {(supplierPos.data ?? [])
                            .filter((p) => p.supplierName === supplier?.label)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.number} · ₹{Number(p.totalAmount).toLocaleString('en-IN')}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                  </div>
                </section>
              )}

              {/* an order is made in the full Orders / PIs form */}
              {action === 'order' && (
                <section className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-[12.5px] text-slate-700">
                  <b className="text-slate-900">Next: the full order form.</b> Check the values read below, then press <i>Open in the order form</i>. It opens
                  the same form as Sales → Orders &amp; PIs with all of this filled in — buyer, products, packing, rates, ports, today&apos;s exchange rate,
                  bank and terms — with this document beside it. Anything not in your masters comes in as typed text, so nothing read is lost.
                </section>
              )}

              {/* the fields read */}
              <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                  What was read <span className="text-[11px] font-normal text-slate-400">● sure ● check ● guess — fix anything wrong; it is remembered for this layout</span>
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {def.fields.map((f) => {
                    const x = item.fields?.[f.key];
                    const changed = x && values[f.key] !== x.value;
                    return (
                      <Field
                        key={f.key}
                        label={
                          <>
                            {dot(changed ? 1 : x?.confidence, x ? `${Math.round(x.confidence * 100)}% · ${x.source}` : 'not found')} {f.label}
                          </>
                        }
                        hint={x && !changed ? `from: “${x.evidence.slice(0, 90)}”` : changed ? 'changed by you' : undefined}
                      >
                        <input
                          data-nav="1"
                          className="field-input"
                          type={f.type === 'date' ? 'date' : 'text'}
                          inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : undefined}
                          value={values[f.key] ?? ''}
                          disabled={done}
                          onChange={(e) => setV(f.key, e.target.value)}
                        />
                      </Field>
                    );
                  })}
                </div>
              </section>

              {/* the item lines read */}
              {action === 'order' && (
                <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <h2 className="text-[13px] font-semibold text-slate-800">Items read ({item.lines?.length ?? 0})</h2>
                  {!item.lines?.length ? (
                    <p className="text-[12.5px] text-slate-500">No item lines were recognised. Add the products in the order form (the original stays beside it).</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12.5px]">
                        <thead className="text-left text-[11.5px] text-slate-500">
                          <tr>
                            {['Item', 'Packing', 'Bags', 'MT', 'Rate / MT', 'Amount', 'Port', 'Code'].map((h) => (
                              <th key={h} className="px-2 py-1 font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {item.lines.map((l, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-2 py-1">{l.description}</td>
                              <td className="px-2 py-1 whitespace-nowrap">{l.packing ?? (l.packKg ? `${l.packKg} KG` : '—')}</td>
                              <td className="px-2 py-1 tabular-nums">{l.bags ?? '—'}</td>
                              <td className="px-2 py-1 tabular-nums">{l.quantityMt ?? '—'}</td>
                              <td className="px-2 py-1 tabular-nums">{l.rate ?? '—'}</td>
                              <td className="px-2 py-1 tabular-nums">{l.amount ?? '—'}</td>
                              <td className="px-2 py-1">{l.port ?? '—'}</td>
                              <td className="px-2 py-1 font-mono text-[11.5px] text-slate-500">{l.buyerItemCode ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              <ErrorBox error={error} />
              {!done && can('sales.intake', 'edit') && (
                <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 py-3">
                  <Button variant="primary" icon={<Check className="size-3.5" />} loading={busy === 'confirm'} onClick={confirm} shortcut="mod+enter" data-nav-end>
                    {action === 'order' ? 'Open in the order form' : action === 'lot' ? 'Update the lot' : action === 'lot-doc' ? 'Tick on the lot checklist' : action === 'order-lc' ? 'Add LC to the order' : action === 'purchase' ? 'Enter the purchase invoice' : action === 'vendor-po' ? 'Save the purchase order' : 'Confirm and file'}
                  </Button>
                  <span className="text-[12px] text-slate-500">Enter next field · Ctrl+Enter confirm · Alt+I ignore · Alt+N next · Esc back</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={del}
        title="Delete this document?"
        message="It moves to the recycle bin and can be restored from there. Anything already confirmed from it stays."
        confirmLabel="Delete"
        danger
        requireReason
        onClose={() => setDel(false)}
        onConfirm={async (reason) => {
          await api.del(`/intake/${id}`, { reason });
          qc.invalidateQueries({ queryKey: ['inbox'] });
          navigate('/inbox');
        }}
      />
    </div>
  );
}

function Field({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1">
      <span className="text-[12px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="truncate text-[11px] text-slate-400" title={hint}>{hint}</span>}
    </div>
  );
}
