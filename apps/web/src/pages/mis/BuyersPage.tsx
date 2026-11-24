import { Users, UserCheck, Wallet, Crown } from 'lucide-react';
import { HBar, MisPage, SimpleTable } from '../../components/MisPage';
import { Kpi, num, Panel } from '../../components/mis';

interface Buyer {
  id: string;
  name: string;
  revenue_rpt: string;
  outstanding_rpt: string;
  invoices: number;
  volume_mt: string;
  last_order: string | null;
  country: string;
}
interface Data {
  buyers: Buyer[];
}
const mt = (v: number) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT`;

export function BuyersPage() {
  return (
    <MisPage<Data> title="Buyers" path="/mis/buyers" subtitle="Buyer & market intelligence">
      {(d, f) => {
        const total = d.buyers.length;
        const repeat = d.buyers.filter((b) => b.invoices > 1).length;
        const totalRev = d.buyers.reduce((a, b) => a + num(b.revenue_rpt), 0);
        const outstanding = d.buyers.reduce((a, b) => a + num(b.outstanding_rpt), 0);
        const top5 = d.buyers.slice(0, 5).reduce((a, b) => a + num(b.revenue_rpt), 0);
        const share = totalRev > 0 ? Math.round((top5 / totalRev) * 100) : 0;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Active buyers" value={String(total)} icon={<Users className="size-5" />} tone="indigo" />
              <Kpi label="Repeat buyers" value={String(repeat)} icon={<UserCheck className="size-5" />} tone="emerald" sub={`${total - repeat} single-order`} />
              <Kpi label="Top-5 share" value={`${share}%`} icon={<Crown className="size-5" />} tone="amber" sub="revenue concentration" />
              <Kpi label="Outstanding" value={f.fmt(outstanding)} icon={<Wallet className="size-5" />} tone="rose" sub="across all buyers" />
            </div>
            <Panel title="Top buyers by revenue" subtitle={`${f.ccy} · click a bar to filter`}>
              <HBar data={d.buyers.slice(0, 10).map((b) => ({ name: b.name, value: num(b.revenue_rpt), pick: b.id }))} fmt={(v) => f.fmt(v)} width={140} onPick={(v) => f.set('buyerId', v)} />
            </Panel>
            <Panel title="Buyer scorecard" subtitle="Revenue, volume, outstanding & AOV · click a row to filter">
              <SimpleTable
                columns={[
                  { key: 'name', label: 'Buyer' },
                  { key: 'country', label: 'Top destination' },
                  { key: 'revenue_rpt', label: `Revenue (${f.sym})`, num: true, render: (r) => f.fmt(r.revenue_rpt as string) },
                  { key: 'invoices', label: 'Orders', num: true },
                  { key: 'aov', label: `Avg order (${f.sym})`, num: true, render: (r) => f.fmt(num(r.revenue_rpt) / Math.max(1, num(r.invoices))) },
                  { key: 'volume_mt', label: 'Volume', num: true, render: (r) => mt(num(r.volume_mt)) },
                  { key: 'outstanding_rpt', label: `Outstanding (${f.sym})`, num: true, render: (r) => f.fmt(r.outstanding_rpt as string) },
                  { key: 'last_order', label: 'Last order' },
                  { key: 'repeat', label: 'Type', render: (r) => (num(r.invoices) > 1 ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">Repeat</span> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">New</span>) },
                ]}
                rows={d.buyers as unknown as Record<string, unknown>[]}
                onRow={(r) => r.id && f.set('buyerId', String(r.id))}
              />
            </Panel>
          </>
        );
      }}
    </MisPage>
  );
}
