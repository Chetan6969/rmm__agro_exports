/**
 * Review one inbox document: the original on the left, what was read from it on the right.
 * Every value shows how sure the reader is and the words it came from; the person fixes what is
 * wrong, picks the order / lot, and confirms. Corrections are remembered for this document layout.
 */
import { INTAKE_KINDS, intakeKind, type Extracted, type ExtractedLine } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronRight, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
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
  suggest: {
    buyer: Ref | null;
    currency: (Ref & { rate: string }) | null;
    portOfLoading: Ref | null;
    portOfDischarge: Ref | null;
    lines: { port: Ref | null; packing: Ref | null; product: Ref | null }[];
  } | null;
}
interface OrderLine {
  key: number;
  productId: string | null;
  productLabel: string | null;
  packingTypeId: string | null;
  packingLabel: string | null;
  destinationPortId: string | null;
  portLabel: string | null;
  quantityMt: string;
  ratePerMt: string;
  dispatchBy: string;
  buyerItemCode: string;
  brand: string;
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
  const [buyer, setBuyer] = useState<Ref | null>(null);
  const [currency, setCurrency] = useState<Ref | null>(null);
  const [rate, setRate] = useState('');
  const [pol, setPol] = useState<Ref | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [del, setDel] = useState(false);
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
    setBuyer(item.suggest?.buyer ?? null);
    setCurrency(item.suggest?.currency ?? null);
    setRate(item.suggest?.currency?.rate ? String(Number(item.suggest.currency.rate)) : '');
    setPol(item.suggest?.portOfLoading ?? null);
    setLines(
      (item.lines ?? []).map((l, i) => {
        const s = item.suggest?.lines[i];
        return {
          key: i,
          productId: s?.product?.id ?? null,
          productLabel: s?.product?.label ?? null,
          packingTypeId: s?.packing?.id ?? null,
          packingLabel: s?.packing?.label ?? null,
          destinationPortId: s?.port?.id ?? null,
          portLabel: s?.port?.label ?? l.port,
          quantityMt: l.quantityMt ?? '',
          ratePerMt: l.rate ?? '',
          dispatchBy: l.dispatchBy ?? (item.fields?.deliveryDate?.value ?? ''),
          buyerItemCode: l.buyerItemCode ?? '',
          brand: item.fields?.brand?.value ?? '',
        };
      }),
    );
  }, [item]);

  const lots = useQuery({ queryKey: ['inbox', 'lots', order?.id], queryFn: () => api.get<Lot[]>(`/intake/lots${qs({ orderId: order?.id })}`), enabled: !!order?.id });
  const def = intakeKind(kind);
  const action = def.action;
  const done = item?.status === 'CONFIRMED';
  const nextId = useMemo(() => next.data?.rows.find((r) => r.id !== id)?.id ?? null, [next.data, id]);

  const confirm = async () => {
    if (!item || done) return;
    setBusy('confirm');
    setError(null);
    try {
      const body: Record<string, unknown> = { kind, fields: values, orderId: order?.id ?? null, shipmentId: lotId };
      if (action === 'order') {
        body.order = {
          buyerId: buyer?.id ?? null,
          currencyId: currency?.id ?? null,
          exchangeRate: rate || null,
          portOfLoadingId: pol?.id ?? null,
          lines: lines.map((l) => ({
            productId: l.productId,
            packingTypeId: l.packingTypeId,
            destinationPortId: l.destinationPortId,
            quantityMt: l.quantityMt,
            ratePerMt: l.ratePerMt,
            dispatchBy: l.dispatchBy || null,
            buyerItemCode: l.buyerItemCode || null,
            brand: l.brand || null,
          })),
        };
      }
      const r = await api.post<{ result: string; learned: number }>(`/intake/${id}/confirm`, body);
      toast.success('Confirmed', { description: `${r.result.startsWith('order:') ? 'Order saved.' : r.result.startsWith('lot:') ? 'Lot updated.' : 'Filed.'}${r.learned ? ` ${r.learned} correction(s) remembered for this layout.` : ''}` });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      if (r.result.startsWith('order:') && action === 'order') navigate(`/d/proformaInvoices/${r.result.slice(6)}`);
      else if (nextId) navigate(`/inbox/${nextId}`);
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
    [values, kind, order, lotId, buyer, currency, rate, pol, lines, nextId, item],
    { inInputs: true },
  );

  if (q.isLoading) return <Spinner />;
  if (q.error || !item) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const reading = ['QUEUED', 'READING'].includes(item.status);
  const fileUrl = `/api/files/${item.fileId}`;
  const setV = (k: string, v: string) => setValues((o) => ({ ...o, [k]: v }));
  const setLine = (i: number, patch: Partial<OrderLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

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
                    <Link className="font-medium underline" to={`/d/proformaInvoices/${item.result.slice(6)}`}>
                      Open the order
                    </Link>
                  )}
                  {item.result?.startsWith('lot:') && item.orderId && (
                    <Link className="font-medium underline" to={`/plan/${item.orderId}`}>
                      Open the order's lots
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

              {/* order header pickers */}
              {action === 'order' && (
                <section className="space-y-2 rounded-lg border border-indigo-200 bg-white p-3">
                  <h2 className="text-[13px] font-semibold text-slate-800">New order from this {kind === 'proforma' ? 'PI' : 'PO / contract'}</h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Buyer" hint={values.buyerName ? `read: ${values.buyerName}` : undefined}>
                      <RefSelect entity="customers" value={buyer?.id ?? null} label={buyer?.label ?? null} allowCreate disabled={done} onChange={(bid, l) => setBuyer(bid ? { id: bid, label: l ?? '' } : null)} />
                    </Field>
                    <Field label="Currency">
                      <RefSelect
                        entity="currencies"
                        value={currency?.id ?? null}
                        label={currency?.label ?? null}
                        disabled={done}
                        onChange={async (cid, l) => {
                          setCurrency(cid ? { id: cid, label: l ?? '' } : null);
                          if (cid) {
                            const c = await api.get<{ exchangeRate: string }>(`/masters/currencies/${cid}`).catch(() => null);
                            if (c?.exchangeRate) setRate(String(Number(c.exchangeRate)));
                          }
                        }}
                      />
                    </Field>
                    <Field label="Exchange rate (₹ per unit)">
                      <input data-nav="1" className="field-input" inputMode="decimal" value={rate} disabled={done} onChange={(e) => setRate(e.target.value)} />
                    </Field>
                    <Field label="Port of loading" hint={values.portOfLoading ? `read: ${values.portOfLoading}` : undefined}>
                      <RefSelect entity="ports" value={pol?.id ?? null} label={pol?.label ?? null} allowCreate disabled={done} onChange={(pid, l) => setPol(pid ? { id: pid, label: l ?? '' } : null)} />
                    </Field>
                  </div>
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

              {/* order lines */}
              {action === 'order' && (
                <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[13px] font-semibold text-slate-800">Order lines ({lines.length})</h2>
                    {!done && (
                      <Button
                        icon={<Plus className="size-3.5" />}
                        onClick={() => setLines((ls) => [...ls, { key: Date.now(), productId: null, productLabel: null, packingTypeId: null, packingLabel: null, destinationPortId: null, portLabel: null, quantityMt: '', ratePerMt: '', dispatchBy: values.deliveryDate ?? '', buyerItemCode: '', brand: values.brand ?? '' }])}
                      >
                        Add line
                      </Button>
                    )}
                  </div>
                  {!lines.length && <p className="text-[12.5px] text-slate-500">No item lines were recognised. Add them with "Add line" (the original is on the left).</p>}
                  {lines.map((l, i) => (
                    <div key={l.key} className="grid gap-2 rounded border border-slate-200 p-2 sm:grid-cols-6">
                      <div className="sm:col-span-2">
                        <Field label="Product">
                          <RefSelect entity="products" value={l.productId} label={l.productLabel} allowCreate disabled={done} onChange={(pid, lb) => setLine(i, { productId: pid, productLabel: lb })} />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Packing">
                          <RefSelect entity="packingTypes" value={l.packingTypeId} label={l.packingLabel} allowCreate disabled={done} onChange={(pid, lb) => setLine(i, { packingTypeId: pid, packingLabel: lb })} />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Deliver to (port)">
                          <RefSelect entity="ports" value={l.destinationPortId} label={l.portLabel} allowCreate disabled={done} onChange={(pid, lb) => setLine(i, { destinationPortId: pid, portLabel: lb })} />
                        </Field>
                      </div>
                      <Field label="MT">
                        <input data-nav="1" className="field-input" inputMode="decimal" value={l.quantityMt} disabled={done} onChange={(e) => setLine(i, { quantityMt: e.target.value })} />
                      </Field>
                      <Field label="Rate / MT">
                        <input data-nav="1" className="field-input" inputMode="decimal" value={l.ratePerMt} disabled={done} onChange={(e) => setLine(i, { ratePerMt: e.target.value })} />
                      </Field>
                      <Field label="Dispatch by">
                        <input data-nav="1" className="field-input" type="date" value={l.dispatchBy} disabled={done} onChange={(e) => setLine(i, { dispatchBy: e.target.value })} />
                      </Field>
                      <Field label="Buyer item code">
                        <input data-nav="1" className="field-input" value={l.buyerItemCode} disabled={done} onChange={(e) => setLine(i, { buyerItemCode: e.target.value })} />
                      </Field>
                      <Field label="Brand">
                        <input data-nav="1" className="field-input" value={l.brand} disabled={done} onChange={(e) => setLine(i, { brand: e.target.value })} />
                      </Field>
                      <div className="flex items-end">
                        {!done && (
                          <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                            Remove
                          </Button>
                        )}
                      </div>
                      {item.lines?.[i] && <p className="text-[11.5px] text-slate-400 sm:col-span-6">read: “{item.lines[i].description}”</p>}
                    </div>
                  ))}
                </section>
              )}

              <ErrorBox error={error} />
              {!done && can('sales.intake', 'edit') && (
                <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 py-3">
                  <Button variant="primary" icon={<Check className="size-3.5" />} loading={busy === 'confirm'} onClick={confirm} shortcut="mod+enter" data-nav-end>
                    {action === 'order' ? 'Create the order' : action === 'lot' ? 'Update the lot' : action === 'lot-doc' ? 'Tick on the lot checklist' : action === 'order-lc' ? 'Add LC to the order' : 'Confirm and file'}
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
