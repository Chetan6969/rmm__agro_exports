import { CheckCircle2, FileSignature, PackageCheck, Target } from 'lucide-react';
import { Link } from 'react-router';
import { Donut, MisPage, SimpleTable } from '../../components/MisPage';
import { inr, Kpi, num, Panel, statusLabel } from '../../components/mis';

interface Data {
  byStatus: { status: string; count: number; value_inr: string }[];
  summary: { total: number; confirmed: number; fulfilled: number; cancelled: number; contract_value_inr: string; contract_qty_mt: string; executed_value_inr: string; executed_qty_mt: string };
  orders: { id: string; number: string; date: string; buyer: string; currency: string; status: string; value: string; value_inr: string; qty_mt: string; executed_inr: string }[];
}

export function OrdersPage() {
  return (
    <MisPage<Data> title="Orders & contracts" path="/mis/orders" subtitle="Proforma orders: contract vs executed value">
      {(d) => {
        const s = d.summary;
        const fulfil = num(s.contract_value_inr) > 0 ? Math.round((num(s.executed_value_inr) / num(s.contract_value_inr)) * 100) : 0;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Total orders" value={String(s.total)} icon={<FileSignature className="size-5" />} tone="indigo" sub={`${s.confirmed} active · ${s.fulfilled} fulfilled`} />
              <Kpi label="Contract value" value={inr(s.contract_value_inr)} icon={<Target className="size-5" />} tone="violet" sub={`${num(s.contract_qty_mt).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT ordered`} />
              <Kpi label="Executed value" value={inr(s.executed_value_inr)} icon={<PackageCheck className="size-5" />} tone="emerald" sub="billed against orders" />
              <Kpi label="Fulfilment" value={`${fulfil}%`} icon={<CheckCircle2 className="size-5" />} tone="amber" sub="executed ÷ contract" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Orders by status" subtitle="Count">
                <Donut data={d.byStatus.map((x) => ({ name: statusLabel(x.status), value: x.count }))} fmt={(v) => String(v)} />
              </Panel>
              <Panel title="Order value by status" subtitle="INR">
                <Donut data={d.byStatus.map((x) => ({ name: statusLabel(x.status), value: num(x.value_inr) }))} fmt={(v) => inr(v)} />
              </Panel>
            </div>
            <Panel title="Orders" subtitle="Contract value and what has been executed (billed)">
              <SimpleTable
                columns={[
                  { key: 'number', label: 'Order', render: (r) => <Link to={`/d/proformaInvoices/${r.id}`} className="font-mono text-[12px] font-medium text-brand-700 hover:underline">{String(r.number)}</Link> },
                  { key: 'date', label: 'Date' },
                  { key: 'buyer', label: 'Buyer' },
                  { key: 'status', label: 'Status', render: (r) => statusLabel(String(r.status)) },
                  { key: 'qty_mt', label: 'Qty MT', num: true, render: (r) => num(r.qty_mt).toLocaleString('en-IN', { maximumFractionDigits: 1 }) },
                  { key: 'value_inr', label: 'Contract (₹)', num: true, render: (r) => inr(r.value_inr as string) },
                  { key: 'executed_inr', label: 'Executed (₹)', num: true, render: (r) => inr(r.executed_inr as string) },
                  { key: 'pct', label: 'Done', num: true, render: (r) => `${num(r.value_inr) > 0 ? Math.round((num(r.executed_inr) / num(r.value_inr)) * 100) : 0}%` },
                ]}
                rows={d.orders as unknown as Record<string, unknown>[]}
              />
            </Panel>
          </>
        );
      }}
    </MisPage>
  );
}
