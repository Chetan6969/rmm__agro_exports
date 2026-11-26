/**
 * Automatic planning on the order's "Plan shipments" page:
 *  1. lots from the order lines (dispatch window → port → containers), preview then apply
 *  2. packaging to buy for the planned bags (+ free %), supplier and rate per line
 *  3. one purchase order per supplier, printable
 */
import { formatAmount, type PlannedLot } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, PackageCheck, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useHotkeys } from '../lib/hotkeys';
import { showError } from '../lib/notify';
import { useSession } from '../lib/session';
import { RefSelect } from './RefSelect';
import { Badge, Button, ErrorBox } from './ui';

interface PackItem {
  id: string;
  component: string;
  label: string;
  packingName: string;
  bags: number;
  perBag: string;
  freePct: string;
  quantity: number;
  supplierId: string | null;
  supplierName: string | null;
  rate: string | null;
  status: 'TO_ORDER' | 'ORDERED';
  vendorPoId: string | null;
}
interface VendorPo {
  id: string;
  number: string;
  poDate: string;
  status: string;
  totalAmount: string;
  supplierName: string | null;
  lines: { description: string; quantity: number }[];
}
interface Planning {
  order: { number: string; status: string; buyerPoRef: string | null };
  input: { lineId: string; label: string; packKg: number; containerLoadMt: number; portName: string | null; quantityMt: number; dispatchBy: string | null }[];
  options: { maxContainersPerLot: number; defaultContainerLoadMt: number };
  suggestedMarket: 'GULF' | 'EU';
  lots: { id: string; lotNo: number; status: string; lines: unknown[] }[];
  packaging: PackItem[];
  vendorPos: VendorPo[];
  supplierHints: { item: string; written: string; supplierName: string | null }[];
}

const fmt = (n: number, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d });

export function AutoPlanPanel({ piId, onChanged }: { piId: string; onChanged: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['planning', piId], queryFn: () => api.get<Planning>(`/planning/${piId}`) });
  const [maxCt, setMaxCt] = useState<number | null>(null);
  const [load, setLoad] = useState<number | null>(null);
  const [market, setMarket] = useState<'GULF' | 'EU' | null>(null);
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<{ lots: PlannedLot[]; warnings: string[] } | null>(null);
  const [freePct, setFreePct] = useState(2);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['planning', piId] });
    onChanged();
  };

  const d = q.data;
  const opts = { maxContainersPerLot: maxCt ?? d?.options.maxContainersPerLot ?? 26, defaultContainerLoadMt: load ?? d?.options.defaultContainerLoadMt ?? 23 };
  const mkt = market ?? d?.suggestedMarket ?? 'GULF';
  const hasLots = (d?.lots ?? []).length > 0;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
      showError(e);
    } finally {
      setBusy(null);
    }
  };
  const doPreview = () => run('preview', async () => setPreview(await api.post(`/planning/${piId}/preview`, opts)));
  const doApply = () =>
    run('apply', async () => {
      const r = await api.post<{ created: number }>(`/planning/${piId}/apply`, { ...opts, market: mkt, replace });
      toast.success(`${r.created} lot(s) planned`, { description: 'Lots, bags and containers are set. Work out the packaging next.' });
      setPreview(null);
      refresh();
    });
  const doPackaging = () =>
    run('pack', async () => {
      await api.post(`/planning/${piId}/packaging`, { freePct });
      toast.success('Packaging worked out');
      refresh();
    });
  const doPos = () =>
    run('po', async () => {
      const r = await api.post<{ created: string[] }>(`/planning/${piId}/vendor-pos`, {});
      toast.success(`${r.created.length} purchase order(s) created`, { description: 'Open each one to print and send it to the supplier.' });
      refresh();
    });
  useHotkeys({ 'alt+p': () => doPreview(), 'alt+g': () => preview && doApply() }, [opts, preview, mkt, replace]);

  if (q.isLoading) return null;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return null;
  const toOrder = d.packaging.filter((p) => p.status === 'TO_ORDER');

  return (
    <div className="space-y-4">
      {/* 1. automatic lots */}
      <section className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Wand2 className="size-4 text-indigo-600" />
          <h2 className="text-[14px] font-semibold text-slate-800">Automatic plan</h2>
          <span className="text-[12px] text-slate-500">Lots from the order lines: dispatch window (P1 = 1–15, P2 = 16–end) → port → containers</span>
        </div>
        {!d.input.length ? (
          <p className="text-[13px] text-slate-500">The order has no lines yet.</p>
        ) : (
          <>
            <div className="mb-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-left text-[11.5px] text-slate-500">
                  <tr>
                    {['Order line', 'Port', 'Dispatch by', 'MT', 'kg / bag', 'MT / 20\''].map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.input.map((l) => (
                    <tr key={l.lineId} className="border-t border-slate-100">
                      <td className="px-2 py-1">{l.label}</td>
                      <td className="px-2 py-1">{l.portName ?? <span className="text-amber-600">—</span>}</td>
                      <td className="px-2 py-1">{l.dispatchBy ?? <span className="text-amber-600">—</span>}</td>
                      <td className="px-2 py-1 tabular-nums">{fmt(l.quantityMt, 3)}</td>
                      <td className="px-2 py-1 tabular-nums">{l.packKg || <span className="text-amber-600">—</span>}</td>
                      <td className="px-2 py-1 tabular-nums">{l.containerLoadMt || <span className="text-slate-400">{opts.defaultContainerLoadMt}*</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-3 text-[12.5px]">
              <label className="grid gap-1">
                Max containers / lot
                <input className="field-input w-24" type="number" min={1} value={opts.maxContainersPerLot} onChange={(e) => setMaxCt(Number(e.target.value))} />
              </label>
              <label className="grid gap-1">
                Default MT / 20'
                <input className="field-input w-24" type="number" min={1} step="0.1" value={opts.defaultContainerLoadMt} onChange={(e) => setLoad(Number(e.target.value))} />
              </label>
              <label className="grid gap-1">
                Market
                <select className="field-input w-28" value={mkt} onChange={(e) => setMarket(e.target.value as 'GULF' | 'EU')}>
                  <option value="GULF">Gulf</option>
                  <option value="EU">EU</option>
                </select>
              </label>
              {hasLots && (
                <label className="flex items-center gap-1.5 pb-1.5">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the planned lots
                </label>
              )}
              <Button icon={<Sparkles className="size-3.5" />} loading={busy === 'preview'} onClick={doPreview} shortcut="alt+p">
                Preview
              </Button>
              {preview && can('sales.shipments', 'create') && (
                <Button variant="primary" loading={busy === 'apply'} onClick={doApply} shortcut="alt+g" disabled={hasLots && !replace}>
                  Create {preview.lots.length} lot(s)
                </Button>
              )}
            </div>
          </>
        )}
        {preview && (
          <div className="mt-3 space-y-2">
            {preview.warnings.map((w) => (
              <div key={w} className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-800">
                {w}
              </div>
            ))}
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {preview.lots.map((lot) => (
                <div key={lot.lotNo} className="rounded-lg border border-slate-200 p-2.5 text-[12.5px]">
                  <div className="mb-1 flex items-center justify-between">
                    <b>Lot {lot.lotNo}</b>
                    <Badge tone="blue">{lot.period}</Badge>
                  </div>
                  <div className="mb-1 text-slate-600">
                    {fmt(lot.quantityMt, 3)} MT · {fmt(lot.bags)} bags · {lot.containers} × 20'
                  </div>
                  {lot.lines.map((l, i) => (
                    <div key={i} className="flex justify-between gap-2 border-t border-slate-100 py-0.5 text-[12px]">
                      <span className="truncate">
                        {l.portName ?? '—'} · {l.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-600">
                        {fmt(l.quantityMt, 3)} MT · {l.containers} ct
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        <ErrorBox error={error} />
      </section>

      {/* 2. packaging */}
      {hasLots && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <PackageCheck className="size-4 text-emerald-600" />
            <h2 className="text-[14px] font-semibold text-slate-800">Packaging to buy</h2>
            <span className="text-[12px] text-slate-500">From the bags in the lots; spare % covers bags shipped free</span>
            <div className="ml-auto flex items-end gap-2 text-[12.5px]">
              <label className="grid gap-1">
                Spare %
                <input className="field-input w-20" type="number" min={0} max={50} step="0.5" value={freePct} onChange={(e) => setFreePct(Number(e.target.value))} />
              </label>
              {can('sales.vendorPos', 'create') && (
                <Button loading={busy === 'pack'} onClick={doPackaging}>
                  {d.packaging.length ? 'Recalculate' : 'Work out packaging'}
                </Button>
              )}
            </div>
          </div>
          {d.supplierHints.length > 0 && (
            <div className="mb-3 rounded border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[12.5px] text-sky-800">
              The buyer's PO names:{' '}
              {d.supplierHints.map((h, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  <b>{h.item}</b> from {h.written}
                  {h.supplierName ? ` → ${h.supplierName}` : ' (add this supplier in Masters → Suppliers, then Recalculate)'}
                </span>
              ))}
            </div>
          )}
          {d.packaging.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-left text-[11.5px] text-slate-500">
                  <tr>
                    {['Item', 'For packing', 'Bags', 'Per bag', 'Qty to buy', 'Supplier', 'Rate (₹)', ''].map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.packaging.map((p) => (
                    <PackRow key={p.id} p={p} onSaved={refresh} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {toOrder.length > 0 && can('sales.vendorPos', 'create') && (
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" icon={<FileText className="size-3.5" />} loading={busy === 'po'} onClick={doPos} disabled={!toOrder.some((p) => p.supplierId)}>
                Create purchase orders
              </Button>
              <span className="text-[12px] text-slate-500">One per supplier, for the lines that have a supplier.</span>
            </div>
          )}
        </section>
      )}

      {/* 3. purchase orders */}
      {d.vendorPos.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-[14px] font-semibold text-slate-800">Packaging purchase orders</h2>
          <ul className="divide-y divide-slate-100 text-[13px]">
            {d.vendorPos.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center gap-3 py-1.5">
                <a className="font-mono font-medium text-brand-700 hover:underline" href={`/api/vendor-pos/${po.id}/pdf`} target="_blank" rel="noreferrer">
                  {po.number}
                </a>
                <span>{po.supplierName}</span>
                <span className="text-slate-500">{po.lines.length} item(s)</span>
                <span className="tabular-nums">₹{formatAmount(po.totalAmount, 2)}</span>
                <Badge tone={po.status === 'RECEIVED' ? 'green' : po.status === 'CANCELLED' ? 'red' : po.status === 'SENT' ? 'blue' : 'slate'}>{po.status}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PackRow({ p, onSaved }: { p: PackItem; onSaved: () => void }) {
  const { can } = useSession();
  const [rate, setRate] = useState(p.rate ?? '');
  const locked = p.status === 'ORDERED' || !can('sales.vendorPos', 'edit');
  const save = async (body: Record<string, unknown>) => {
    try {
      await api.put(`/packaging-items/${p.id}`, body);
      onSaved();
    } catch (e) {
      showError(e);
    }
  };
  return (
    <tr className="border-t border-slate-100">
      <td className="px-2 py-1 font-medium">{p.label}</td>
      <td className="px-2 py-1">{p.packingName}</td>
      <td className="px-2 py-1 tabular-nums">{fmt(p.bags)}</td>
      <td className="px-2 py-1 tabular-nums">{Number(p.perBag)}</td>
      <td className="px-2 py-1 font-medium tabular-nums">{fmt(p.quantity)}</td>
      <td className="min-w-48 px-2 py-1">
        {locked ? p.supplierName ?? '—' : <RefSelect entity="suppliers" value={p.supplierId} label={p.supplierName} allowCreate placeholder="Choose supplier…" onChange={(id) => save({ supplierId: id })} />}
      </td>
      <td className="px-2 py-1">{locked ? (p.rate ?? '—') : <input className="field-input w-24" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={() => rate !== (p.rate ?? '') && save({ rate })} />}</td>
      <td className="px-2 py-1">{p.status === 'ORDERED' ? <Badge tone="green">Ordered</Badge> : <Badge>To order</Badge>}</td>
    </tr>
  );
}
