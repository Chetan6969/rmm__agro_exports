import { formatAmount } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { showError } from '../lib/notify';
import { useSession } from '../lib/session';
import { Button } from './ui';

interface Receipt {
  id: string;
  paymentDate: string;
  amount: string;
  mode: string | null;
  reference: string | null;
  note: string | null;
}
interface Data {
  invoiceNumber: string;
  currency: string;
  invoiceTotal: string;
  received: string;
  pending: string;
  rows: Receipt[];
}

const MODES = ['Bank transfer', 'LC', 'Cash', 'Cheque', 'Adjustment', 'Other'];
const today = () => new Date().toISOString().slice(0, 10);

/** Receipts recorded against a commercial invoice, with received / pending summary. */
export function ReceiptsPanel({ invoiceId }: { invoiceId: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const canView = can('sales.payments', 'view');
  const canAdd = can('sales.payments', 'create');
  const canDelete = can('sales.payments', 'delete');
  const q = useQuery({ queryKey: ['payments', invoiceId], queryFn: () => api.get<Data>(`/payments?invoice=${invoiceId}`), enabled: canView });
  const [form, setForm] = useState({ paymentDate: today(), amount: '', mode: 'Bank transfer', reference: '', note: '' });
  const [busy, setBusy] = useState(false);

  if (!canView) return null;
  const d = q.data;
  const cur = d?.currency ?? '';
  const refetch = () => qc.invalidateQueries({ queryKey: ['payments', invoiceId] });

  const add = async () => {
    if (!form.amount.trim()) return;
    setBusy(true);
    try {
      await api.post('/payments', { commercialInvoiceId: invoiceId, ...form });
      setForm({ paymentDate: today(), amount: '', mode: form.mode, reference: '', note: '' });
      refetch();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string) => {
    try {
      await api.del(`/payments/${id}`);
      refetch();
    } catch (e) {
      showError(e);
    }
  };

  const money = (v: string | number) => `${cur ? cur + ' ' : ''}${formatAmount(String(v))}`;
  const pct = d && Number(d.invoiceTotal) > 0 ? Math.round((Number(d.received) / Number(d.invoiceTotal)) * 100) : 0;

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
        <Wallet className="size-3.5 text-emerald-600" />
        <h2 className="text-[12px] font-semibold tracking-wide text-slate-500 uppercase">Payments / receipts</h2>
      </div>
      <div className="space-y-3 p-3">
        {/* summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-slate-50 p-2">
            <div className="text-[10.5px] tracking-wide text-slate-400 uppercase">Invoice</div>
            <div className="text-[14px] font-semibold text-slate-800 tabular-nums">{d ? money(d.invoiceTotal) : '—'}</div>
          </div>
          <div className="rounded-md bg-emerald-50 p-2">
            <div className="text-[10.5px] tracking-wide text-emerald-600 uppercase">Received ({pct}%)</div>
            <div className="text-[14px] font-semibold text-emerald-700 tabular-nums">{d ? money(d.received) : '—'}</div>
          </div>
          <div className="rounded-md bg-amber-50 p-2">
            <div className="text-[10.5px] tracking-wide text-amber-600 uppercase">Pending</div>
            <div className="text-[14px] font-semibold text-amber-700 tabular-nums">{d ? money(d.pending) : '—'}</div>
          </div>
        </div>

        {/* receipts table */}
        {d && d.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-400 uppercase">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Mode</th>
                  <th className="py-1 pr-2">Reference</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-1 pr-2 text-slate-600">{r.paymentDate}</td>
                    <td className="py-1 pr-2 text-slate-600">{r.mode ?? '—'}</td>
                    <td className="py-1 pr-2 text-slate-500">{r.reference ?? '—'}</td>
                    <td className="py-1 pr-2 text-right font-medium tabular-nums text-slate-800">{money(r.amount)}</td>
                    <td className="py-1 text-right">
                      {canDelete && (
                        <button type="button" aria-label="Delete receipt" title="Delete receipt" onClick={() => del(r.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* add receipt */}
        {canAdd && (
          <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-100 bg-slate-50/50 p-2 sm:grid-cols-6">
            <input type="date" className="field-input" value={form.paymentDate} onChange={(e) => setForm((s) => ({ ...s, paymentDate: e.target.value }))} aria-label="Payment date" />
            <input className="field-input text-right tabular-nums" inputMode="decimal" placeholder="Amount" value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} aria-label="Amount" />
            <select className="field-input" value={form.mode} onChange={(e) => setForm((s) => ({ ...s, mode: e.target.value }))} aria-label="Mode">
              {MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input className="field-input sm:col-span-2" placeholder="Reference / note" value={form.reference} onChange={(e) => setForm((s) => ({ ...s, reference: e.target.value }))} aria-label="Reference" />
            <Button variant="primary" icon={<Plus className="size-3.5" />} loading={busy} onClick={add}>
              Add
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
