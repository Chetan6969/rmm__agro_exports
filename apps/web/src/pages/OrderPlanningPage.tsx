import { add, formatAmount, mul, round, sub } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileText, Package, Plus, Save, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ReceiptsPanel } from '../components/ReceiptsPanel';
import { RefSelect } from '../components/RefSelect';
import { Button, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { showError } from '../lib/notify';
import { useSession } from '../lib/session';

interface ChargeHead { id: string; code: string; name: string; unit: string; defaultAmount: string }
interface Charge { chargeHeadId: string | null; label: string; qty: string; rate: string }
interface Step { key: string; label: string; doc: string | null; done: boolean; date: string | null }
interface Pipeline { steps: Step[]; total: number; done: number; percent: number; next: string | null }
interface Lot {
  id?: string;
  lotNo: number;
  market: 'GULF' | 'EU';
  quantityMt: string;
  containerCount: number;
  targetShipDate: string | null;
  status: string;
  notes: string | null;
  charges: Charge[];
  productionOrderId?: string | null;
  commercialInvoiceId?: string | null;
  oceanBillId?: string | null;
  pipeline?: Pipeline;
}
interface Plan {
  pi: { id: string; number: string; date: string; totalMt: string; buyer: string | null; incoterm: string; currency: string | null };
  shipments: Lot[];
  plannedMt: string;
  remainingMt: string;
  chargeHeads: ChargeHead[];
}

const num = (v: unknown) => Number(v ?? 0);
const amt = (c: Charge) => round(mul(c.qty || '0', c.rate || '0', 2), 2);

export function OrderPlanningPage() {
  const { piId = '' } = useParams();
  const { can, session } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plan', piId], queryFn: () => api.get<Plan>(`/shipments/plan/${piId}`), enabled: !!session?.activeCompany });
  const [drafts, setDrafts] = useState<number[]>([]);
  const canEdit = can('sales.shipments', 'create');

  if (q.isLoading) return <Spinner label="Loading order…" />;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const plan = q.data!;
  const cur = plan.pi.currency ?? '';
  const total = num(plan.pi.totalMt);
  const planned = num(plan.plannedMt);
  const remaining = num(plan.remainingMt);
  const pct = total > 0 ? Math.min(100, Math.round((planned / total) * 100)) : 0;
  const refetch = () => qc.invalidateQueries({ queryKey: ['plan', piId] });
  const nextLot = () => (plan.shipments.length ? Math.max(...plan.shipments.map((s) => s.lotNo)) : 0) + drafts.length + 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <button type="button" tabIndex={-1} onClick={() => navigate(`/d/proformaInvoices/${piId}`)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
            Plan shipments · <Link to={`/d/proformaInvoices/${piId}`} className="font-mono text-brand-700 hover:underline">{plan.pi.number}</Link>
          </span>
        }
        subtitle={`${plan.pi.buyer ?? ''} · ${plan.pi.incoterm} · order ${formatAmount(plan.pi.totalMt, 3)} MT`}
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {/* order progress */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div className="flex gap-6 text-[13px]">
              <div><div className="text-[11px] tracking-wide text-slate-400 uppercase">Order</div><div className="text-lg font-semibold tabular-nums">{formatAmount(plan.pi.totalMt, 3)} MT</div></div>
              <div><div className="text-[11px] tracking-wide text-slate-400 uppercase">Planned</div><div className="text-lg font-semibold text-indigo-600 tabular-nums">{formatAmount(plan.plannedMt, 3)} MT</div></div>
              <div><div className="text-[11px] tracking-wide text-slate-400 uppercase">Remaining</div><div className={`text-lg font-semibold tabular-nums ${remaining > 0.001 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatAmount(plan.remainingMt, 3)} MT</div></div>
            </div>
            <span className="text-[12px] text-slate-400">{plan.shipments.length} lot{plan.shipments.length === 1 ? '' : 's'}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {plan.shipments.map((lot) => (
          <LotCard key={lot.id} lot={lot} heads={plan.chargeHeads} currency={cur} piId={piId} readOnly={!canEdit} onDone={refetch} />
        ))}
        {drafts.map((d) => (
          <LotCard
            key={`draft-${d}`}
            lot={{ lotNo: nextLot(), market: 'GULF', quantityMt: remaining > 0 ? round(String(remaining), 3) : '', containerCount: 0, targetShipDate: null, status: 'PLANNED', notes: null, charges: [] }}
            heads={plan.chargeHeads}
            currency={cur}
            piId={piId}
            readOnly={false}
            isDraft
            onDone={() => {
              setDrafts((s) => s.filter((x) => x !== d));
              refetch();
            }}
            onCancel={() => setDrafts((s) => s.filter((x) => x !== d))}
          />
        ))}

        {canEdit && (
          <Button icon={<Plus className="size-3.5" />} onClick={() => setDrafts((s) => [...s, Date.now()])}>
            Add lot
          </Button>
        )}
      </div>
    </div>
  );
}

function LotCard({ lot, heads, currency, piId, readOnly, isDraft, onDone, onCancel }: { lot: Lot; heads: ChargeHead[]; currency: string; piId: string; readOnly: boolean; isDraft?: boolean; onDone: () => void; onCancel?: () => void }) {
  const [s, setS] = useState<Lot>(() => ({ ...lot, charges: lot.charges.map((c) => ({ ...c })) }));
  const [busy, setBusy] = useState(false);
  const chargeTotal = add(s.charges.map(amt), 2);

  const addCharge = (headId: string) => {
    const h = heads.find((x) => x.id === headId);
    if (!h) return;
    const qty = h.unit === 'Per 20ft container' ? String(s.containerCount || 1) : h.unit === 'Per MT' ? round(s.quantityMt || '0', 3) : '1';
    setS((v) => ({ ...v, charges: [...v.charges, { chargeHeadId: h.id, label: h.name, qty, rate: round(h.defaultAmount, 2) }] }));
  };
  const setCharge = (i: number, patch: Partial<Charge>) => setS((v) => ({ ...v, charges: v.charges.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const save = async () => {
    setBusy(true);
    try {
      const body = { proformaInvoiceId: piId, lotNo: s.lotNo, market: s.market, quantityMt: s.quantityMt || '0', containerCount: Number(s.containerCount) || 0, targetShipDate: s.targetShipDate || null, status: s.status, notes: s.notes || null, productionOrderId: s.productionOrderId || null, commercialInvoiceId: s.commercialInvoiceId || null, oceanBillId: s.oceanBillId || null, charges: s.charges };
      if (s.id) await api.put(`/shipments/${s.id}`, body);
      else await api.post('/shipments', body);
      toast.success(`Lot ${s.lotNo} saved`);
      onDone();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!s.id) return onCancel?.();
    setBusy(true);
    try {
      await api.del(`/shipments/${s.id}`);
      toast.success(`Lot ${s.lotNo} removed`);
      onDone();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const field = 'field-input';
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${isDraft ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-indigo-50 text-[12px] font-semibold text-indigo-700"><Package className="size-3.5" /></span>
        <h3 className="text-[13px] font-semibold text-slate-800">Lot {s.lotNo}</h3>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${s.market === 'EU' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>{s.market === 'EU' ? 'EU' : 'Gulf'}</span>
        <span className="ml-auto text-[12px] text-slate-400">Charges {currency} {formatAmount(chargeTotal)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <L label="Market"><select className={field} disabled={readOnly} value={s.market} onChange={(e) => setS((v) => ({ ...v, market: e.target.value as 'GULF' | 'EU' }))}><option value="GULF">Gulf</option><option value="EU">EU</option></select></L>
        <L label="Quantity (MT)"><input className={`${field} text-right tabular-nums`} inputMode="decimal" disabled={readOnly} value={s.quantityMt} onChange={(e) => setS((v) => ({ ...v, quantityMt: e.target.value }))} /></L>
        <L label="Containers"><input className={`${field} text-right tabular-nums`} inputMode="numeric" disabled={readOnly} value={String(s.containerCount ?? '')} onChange={(e) => setS((v) => ({ ...v, containerCount: Number(e.target.value) || 0 }))} /></L>
        <L label="Target ship date"><input type="date" className={field} disabled={readOnly} value={s.targetShipDate ?? ''} onChange={(e) => setS((v) => ({ ...v, targetShipDate: e.target.value || null }))} /></L>
        <L label="Status"><select className={field} disabled={readOnly} value={s.status} onChange={(e) => setS((v) => ({ ...v, status: e.target.value }))}>{['PLANNED', 'IN_PROGRESS', 'SHIPPED', 'CANCELLED'].map((x) => <option key={x} value={x}>{x.charAt(0) + x.slice(1).toLowerCase().replace('_', ' ')}</option>)}</select></L>
      </div>

      {/* charges */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Charges</span>
          {!readOnly && (
            <select className="field-input w-auto text-[12px]" value="" onChange={(e) => { if (e.target.value) addCharge(e.target.value); e.target.value = ''; }}>
              <option value="">+ Add charge…</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
        </div>
        {s.charges.length > 0 ? (
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[11px] tracking-wide text-slate-400 uppercase"><th className="py-1 pr-2">Charge</th><th className="py-1 pr-2 text-right">Qty</th><th className="py-1 pr-2 text-right">Rate</th><th className="py-1 pr-2 text-right">Amount</th><th className="w-7" /></tr></thead>
            <tbody>
              {s.charges.map((c, i) => (
                <tr key={i} className="border-t border-slate-50">
                  <td className="py-1 pr-2"><input className="field-input" disabled={readOnly} value={c.label} onChange={(e) => setCharge(i, { label: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input className="field-input w-20 text-right tabular-nums" inputMode="decimal" disabled={readOnly} value={c.qty} onChange={(e) => setCharge(i, { qty: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input className="field-input w-24 text-right tabular-nums" inputMode="decimal" disabled={readOnly} value={c.rate} onChange={(e) => setCharge(i, { rate: e.target.value })} /></td>
                  <td className="py-1 pr-2 text-right font-medium tabular-nums text-slate-800">{formatAmount(amt(c))}</td>
                  <td className="py-1 text-right">{!readOnly && <button type="button" aria-label="Remove charge" onClick={() => setS((v) => ({ ...v, charges: v.charges.filter((_, j) => j !== i) }))} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="size-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[12px] text-slate-400">No charges yet. Pick from the rate-card above.</p>
        )}
      </div>

      {/* linked documents (setting one auto-completes its pipeline step) */}
      <div className="mt-3">
        <span className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Linked documents</span>
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <RefSelect source="document" entity="productionOrders" value={s.productionOrderId ?? null} disabled={readOnly} placeholder="Production order…" onChange={(v) => setS((x) => ({ ...x, productionOrderId: v }))} />
          <RefSelect source="document" entity="oceanBills" value={s.oceanBillId ?? null} disabled={readOnly} placeholder="Bill of lading…" onChange={(v) => setS((x) => ({ ...x, oceanBillId: v }))} />
          <RefSelect source="document" entity="commercialInvoices" value={s.commercialInvoiceId ?? null} disabled={readOnly} placeholder="Commercial invoice…" onChange={(v) => setS((x) => ({ ...x, commercialInvoiceId: v }))} />
        </div>
      </div>

      {/* pipeline (saved lots only) */}
      {lot.id && lot.pipeline && <PipelineStepper shipmentId={lot.id} pipeline={lot.pipeline} readOnly={readOnly} onChanged={onDone} />}

      {/* commercial invoice against this lot + its payments (saved lots only) */}
      {lot.id && <InvoiceSection lot={lot} currency={currency} onDone={onDone} />}

      {!readOnly && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={del}>{isDraft ? 'Cancel' : 'Delete lot'}</Button>
          <Button variant="primary" icon={<Save className="size-3.5" />} loading={busy} onClick={save}>Save lot</Button>
        </div>
      )}
    </div>
  );
}

function PipelineStepper({ shipmentId, pipeline, readOnly, onChanged }: { shipmentId: string; pipeline: Pipeline; readOnly: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const currentIdx = pipeline.steps.findIndex((s) => !s.done);
  const toggle = async (step: Step) => {
    if (readOnly || step.doc) return;
    setBusy(step.key);
    try {
      await api.post(`/shipments/${shipmentId}/stage`, { stageKey: step.key, done: !step.done });
      onChanged();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Pipeline · {pipeline.done}/{pipeline.total}</span>
        <span className="text-[12px] text-slate-400">{pipeline.next ? `Next: ${pipeline.next}` : 'Complete 🎉'}</span>
      </div>
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pipeline.percent}%` }} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pipeline.steps.map((st, i) => {
          const current = i === currentIdx;
          const cls = st.done ? 'border-emerald-500 bg-emerald-500 text-white' : current ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-400';
          return (
            <button
              key={st.key}
              type="button"
              disabled={readOnly || !!st.doc || busy === st.key}
              onClick={() => toggle(st)}
              title={st.doc ? `Auto — completes when the ${st.doc} is linked` : st.done ? `Done ${st.date ?? ''} · click to undo` : 'Click to mark done'}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${cls} ${st.doc ? 'cursor-default' : readOnly ? '' : 'hover:brightness-95'}`}
            >
              {st.done && <Check className="size-3" />}
              {st.doc && !st.done && <FileText className="size-3 opacity-60" />}
              {st.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PaySummary { invoiceTotal: string; received: string; pending: string; currency: string }

/** Create / show the commercial invoice for a lot, its receipts, and the "shipment done" action. */
function InvoiceSection({ lot, currency, onDone }: { lot: Lot; currency: string; onDone: () => void }) {
  const { can } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const ciId = lot.commercialInvoiceId ?? null;
  const done = lot.status === 'SHIPPED';
  const canCreateCI = can('sales.commercialInvoices', 'create');
  const canEditShip = can('sales.shipments', 'edit');
  const pay = useQuery({
    queryKey: ['payments', ciId],
    queryFn: () => api.get<PaySummary>(`/payments?invoice=${ciId}`),
    enabled: !!ciId && can('sales.payments', 'view'),
  });
  const pending = pay.data ? num(pay.data.pending) : null;
  const fullyPaid = pending !== null && pending <= 0.01 && num(pay.data?.invoiceTotal) > 0;

  const complete = async () => {
    setBusy(true);
    try {
      await api.post(`/shipments/${lot.id}/complete`, {});
      toast.success(`Lot ${lot.lotNo} — shipment done`);
      onDone();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">Commercial invoice & payments</span>
        {ciId && <Link to={`/d/commercialInvoices/${ciId}`} className="text-[12px] font-medium text-brand-700 hover:underline">Open invoice →</Link>}
      </div>

      {!ciId ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-slate-500">No invoice yet for this lot.</p>
          {canCreateCI && (
            <Button icon={<FileText className="size-3.5" />} onClick={() => navigate(`/d/commercialInvoices/new?shipment=${lot.id}`)}>
              Create invoice against this lot
            </Button>
          )}
        </div>
      ) : (
        <>
          <ReceiptsPanel invoiceId={ciId} />
          {canEditShip && (
            <div className="mt-2 flex items-center justify-end gap-2">
              {done ? (
                <span className="flex items-center gap-1 text-[12.5px] font-medium text-emerald-700"><Check className="size-3.5" /> Shipment done</span>
              ) : (
                <>
                  {pending !== null && !fullyPaid && <span className="text-[11.5px] text-amber-600">{currency} {formatAmount(String(pending))} pending — mark done once fully received</span>}
                  <Button variant="primary" icon={<Check className="size-3.5" />} disabled={!fullyPaid} loading={busy} onClick={complete}>
                    Mark shipment done
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
