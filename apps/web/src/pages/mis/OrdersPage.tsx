import { CheckCircle2, FileSignature, PackageCheck, Target } from 'lucide-react';
import { Link } from 'react-router';
import { Donut, MisPage, SimpleTable } from '../../components/MisPage';
import { Kpi, num, Panel, statusLabel } from '../../components/mis';

interface Data {
  byStatus: { status: string; count: number; value_rpt: string }[];
  summary: { total: number; confirmed: number; fulfilled: number; cancelled: number; contract_value_rpt: string; contract_qty_mt: string; executed_value_rpt: string; executed_qty_mt: string };
  orders: { id: string; number: string; date: string; buyer: string; currency: string; status: string; value: string; value_rpt: string; qty_mt: string; executed_rpt: string }[];
}

export function OrdersPage() {
  return (
    <MisPage<Data> title="Orders & contracts" path="/mis/orders" subtitle="Proforma orders: contract vs executed value">
      {(d, f) => {
        const s = d.summary;
        const fulfil = num(s.contract_value_rpt) > 0 ? Math.round((num(s.executed_value_rpt) / num(s.contract_value_rpt)) * 100) : 0;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Total orders" value={String(s.total)} icon={<FileSignature className="size-5" />} tone="indigo" sub={`${s.confirmed} active · ${s.fulfilled} fulfilled`} />
              <Kpi label="Contract value" value={f.fmt(s.contract_value_rpt)} icon={<Target className="size-5" />} tone="violet" sub={`${num(s.contract_qty_mt).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT ordered`} />
              <Kpi label="Executed value" value={f.fmt(s.executed_value_rpt)} icon={<PackageCheck className="size-5" />} tone="emerald" sub="billed against orders" />
              <Kpi label="Fulfilment" value={`${fulfil}%`} icon={<CheckCircle2 className="size-5" />} tone="amber" sub="executed ÷ contract" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Orders by status" subtitle="Count · click to filter">
                <Donut data={d.byStatus.map((x) => ({ name: statusLabel(x.status), value: x.count, pick: x.status }))} fmt={(v) => String(v)} onPick={(v) => f.set('status', v)} />
              </Panel>
              <Panel title="Order value by status" subtitle={`${f.ccy} · click to filter`}>
                <Donut data={d.byStatus.map((x) => ({ name: statusLabel(x.status), value: num(x.value_rpt), pick: x.status }))} fmt={(v) => f.fmt(v)} onPick={(v) => f.set('status', v)} />
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
                  { key: 'value_rpt', label: `Contract (${f.sym})`, num: true, render: (r) => f.fmt(r.value_rpt as string) },
                  { key: 'executed_rpt', label: `Executed (${f.sym})`, num: true, render: (r) => f.fmt(r.executed_rpt as string) },
                  { key: 'pct', label: 'Done', num: true, render: (r) => `${num(r.value_rpt) > 0 ? Math.round((num(r.executed_rpt) / num(r.value_rpt)) * 100) : 0}%` },
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
