import { Anchor, Container, Ship, Timer } from 'lucide-react';
import { Link } from 'react-router';
import { Donut, HBar, MisPage, SimpleTable, VBar } from '../../components/MisPage';
import { compact, Kpi, num, Panel, statusLabel } from '../../components/mis';

interface Data {
  summary: { total: number; active: number; shipped: number; cancelled: number; qty_mt: string; containers: number };
  byStatus: { status: string; count: number; qty_mt: string }[];
  byMarket: { market: string; count: number; qty_mt: string }[];
  charges: { head: string; amount: string }[];
  timing: { on_time: number; late: number; in_pipeline: number };
  shipments: { id: string; pi_id: string; order_no: string; buyer: string; market: string; status: string; qty_mt: string; containers: number; target_date: string | null; vessel_name: string | null; bl_number: string | null; bl_date: string | null; discharge_port: string }[];
}
const chip = (ok: boolean, text: string) => <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{text}</span>;

export function LogisticsPage() {
  return (
    <MisPage<Data> title="Logistics" path="/mis/logistics" subtitle="Shipments, pipeline status & planned charges">
      {(d, f) => {
        const s = d.summary;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Shipments" value={String(s.total)} icon={<Ship className="size-5" />} tone="indigo" sub={`${num(s.qty_mt).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT planned`} />
              <Kpi label="In pipeline" value={String(s.active)} icon={<Timer className="size-5" />} tone="amber" sub={`${s.shipped} shipped`} />
              <Kpi label="Containers" value={String(s.containers)} icon={<Container className="size-5" />} tone="sky" sub="planned" />
              <Kpi label="On-time" value={`${d.timing.on_time}`} icon={<Anchor className="size-5" />} tone="emerald" sub={`${d.timing.late} late · ${d.timing.in_pipeline} pending`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="By status"><Donut data={d.byStatus.map((x) => ({ name: statusLabel(x.status), value: x.count }))} fmt={(v) => String(v)} /></Panel>
              <Panel title="By market" subtitle="MT by Gulf / EU"><VBar data={d.byMarket.map((x) => ({ name: x.market, value: num(x.qty_mt) }))} fmt={(v) => compact(v)} /></Panel>
              <Panel title="Planned charges" subtitle={`${f.sym} by head`}>
                {d.charges.length ? <HBar data={d.charges.slice(0, 8).map((c) => ({ name: c.head, value: num(c.amount) }))} fmt={(v) => f.fmt(v)} height={240} width={90} /> : <div className="flex h-[200px] items-center justify-center text-[13px] text-slate-400">No charges recorded</div>}
              </Panel>
            </div>
            <Panel title="Shipments" subtitle="Lot pipeline, target date vs actual B/L">
              <SimpleTable
                columns={[
                  { key: 'order_no', label: 'Order', render: (r) => <Link to={`/d/proformaInvoices/${r.pi_id}`} className="font-mono text-[12px] font-medium text-brand-700 hover:underline">{String(r.order_no)}</Link> },
                  { key: 'buyer', label: 'Buyer' },
                  { key: 'market', label: 'Market' },
                  { key: 'status', label: 'Status', render: (r) => statusLabel(String(r.status)) },
                  { key: 'qty_mt', label: 'Qty MT', num: true, render: (r) => num(r.qty_mt).toLocaleString('en-IN', { maximumFractionDigits: 1 }) },
                  { key: 'containers', label: 'Ctrs', num: true },
                  { key: 'target_date', label: 'Target' },
                  { key: 'vessel_name', label: 'Vessel', render: (r) => (r.vessel_name ? String(r.vessel_name) : '—') },
                  { key: 'bl_number', label: 'B/L', render: (r) => (r.bl_number ? chip(true, String(r.bl_number)) : chip(false, 'pending')) },
                  { key: 'discharge_port', label: 'Discharge' },
                ]}
                rows={d.shipments as unknown as Record<string, unknown>[]}
              />
            </Panel>
          </>
        );
      }}
    </MisPage>
  );
}
