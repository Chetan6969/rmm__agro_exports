import { Banknote, Coins, Landmark, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { MisPage, SimpleTable } from '../../components/MisPage';
import { Kpi, money, num, Panel } from '../../components/mis';

interface Data {
  byCurrency: { currency: string; invoices: number; invoiced: string; received: string; pending: string; invoiced_rpt: string; avg_rate: string }[];
  totals: { revenue_rpt: string; fob_rpt: string; freight_rpt: string; insurance_rpt: string; shipping_rpt: string; discount_rpt: string; received_rpt: string };
  lc: { id: string; number: string; lc_number: string; lc_date: string | null; buyer: string; currency: string; value: string }[];
  marketRates: { currency_code: string; rate_to_rpt: string; rate_date: string; source: string }[];
}

export function FinancialPage() {
  return (
    <MisPage<Data> title="Financial & forex" path="/mis/financial" subtitle="Currency revenue, LC tracking & market rates">
      {(d, f) => {
        const t = d.totals;
        const pending = num(t.revenue_rpt) - num(t.received_rpt);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label={`Revenue (${f.ccy})`} value={f.fmt(t.revenue_rpt)} icon={<Banknote className="size-5" />} tone="indigo" />
              <Kpi label="Received" value={f.fmt(t.received_rpt)} icon={<Wallet className="size-5" />} tone="emerald" />
              <Kpi label="Outstanding" value={f.fmt(pending)} icon={<Coins className="size-5" />} tone="amber" />
              <Kpi label="Shipping charges" value={f.fmt(t.shipping_rpt)} icon={<Landmark className="size-5" />} tone="slate" sub="sale-side (recorded)" />
            </div>
            <Panel title="Revenue by currency" subtitle={`Billed figures per currency + ${f.ccy} equivalent`}>
              <SimpleTable
                columns={[
                  { key: 'currency', label: 'Currency' },
                  { key: 'invoices', label: 'Invoices', num: true },
                  { key: 'invoiced', label: 'Invoiced', num: true, render: (r) => money(r.invoiced as string, String(r.currency)) },
                  { key: 'received', label: 'Received', num: true, render: (r) => money(r.received as string, String(r.currency)) },
                  { key: 'pending', label: 'Pending', num: true, render: (r) => money(r.pending as string, String(r.currency)) },
                  { key: 'avg_rate', label: 'Avg ₹/unit', num: true },
                  { key: 'invoiced_rpt', label: `Invoiced (${f.sym})`, num: true, render: (r) => f.fmt(r.invoiced_rpt as string) },
                ]}
                rows={d.byCurrency as unknown as Record<string, unknown>[]}
              />
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Recorded sale-side charges" subtitle="Freight / insurance / shipping / discount (not procurement cost)">
                <div className="space-y-2 pt-1">
                  {([['FOB value', t.fob_rpt], ['Ocean freight', t.freight_rpt], ['Insurance', t.insurance_rpt], ['Shipping charges', t.shipping_rpt], ['Discount given', t.discount_rpt]] as const).map(([label, v]) => (
                    <div key={label} className="flex justify-between border-b border-slate-50 pb-1.5 text-[13px]">
                      <span className="text-slate-500">{label}</span>
                      <span className="tabular-nums text-slate-700">{f.fmt(v)}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-slate-400">Procurement / milling cost isn't recorded, so this is the sale side only — not full profit.</p>
                </div>
              </Panel>
              <Panel title="Market reference rates" subtitle="Latest fetched ₹ per unit">
                <SimpleTable
                  columns={[
                    { key: 'currency_code', label: 'Currency' },
                    { key: 'rate_to_rpt', label: '₹ / unit', num: true, render: (r) => num(r.rate_to_rpt).toLocaleString('en-IN', { maximumFractionDigits: 4 }) },
                    { key: 'rate_date', label: 'As of' },
                    { key: 'source', label: 'Source' },
                  ]}
                  rows={d.marketRates as unknown as Record<string, unknown>[]}
                  empty="No market rates fetched"
                />
              </Panel>
            </div>
            <Panel title="Letter of credit tracking" subtitle="Invoices carrying an LC number">
              <SimpleTable
                columns={[
                  { key: 'number', label: 'Invoice', render: (r) => <Link to={`/d/commercialInvoices/${r.id}`} className="font-mono text-[12px] font-medium text-brand-700 hover:underline">{String(r.number)}</Link> },
                  { key: 'lc_number', label: 'LC no.' },
                  { key: 'lc_date', label: 'LC date' },
                  { key: 'buyer', label: 'Buyer' },
                  { key: 'value', label: 'Value', num: true, render: (r) => money(r.value as string, String(r.currency)) },
                ]}
                rows={d.lc as unknown as Record<string, unknown>[]}
                empty="No LC-backed invoices in this selection"
              />
            </Panel>
          </>
        );
      }}
    </MisPage>
  );
}
