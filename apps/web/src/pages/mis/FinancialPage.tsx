import { Banknote, Coins, Landmark, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { MisPage, SimpleTable } from '../../components/MisPage';
import { inr, Kpi, money, num, Panel } from '../../components/mis';

interface Data {
  byCurrency: { currency: string; invoices: number; invoiced: string; received: string; pending: string; invoiced_inr: string; avg_rate: string }[];
  totals: { revenue_inr: string; fob_inr: string; freight_inr: string; insurance_inr: string; shipping_inr: string; discount_inr: string; received_inr: string };
  lc: { id: string; number: string; lc_number: string; lc_date: string | null; buyer: string; currency: string; value: string }[];
  marketRates: { currency_code: string; rate_to_inr: string; rate_date: string; source: string }[];
}

export function FinancialPage() {
  return (
    <MisPage<Data> title="Financial & forex" path="/mis/financial" subtitle="Currency revenue, LC tracking & market rates">
      {(d) => {
        const t = d.totals;
        const pending = num(t.revenue_inr) - num(t.received_inr);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Revenue (INR)" value={inr(t.revenue_inr)} icon={<Banknote className="size-5" />} tone="indigo" />
              <Kpi label="Received" value={inr(t.received_inr)} icon={<Wallet className="size-5" />} tone="emerald" />
              <Kpi label="Outstanding" value={inr(pending)} icon={<Coins className="size-5" />} tone="amber" />
              <Kpi label="Shipping charges" value={inr(t.shipping_inr)} icon={<Landmark className="size-5" />} tone="slate" sub="sale-side (recorded)" />
            </div>
            <Panel title="Revenue by currency" subtitle="Billed figures per currency + INR equivalent">
              <SimpleTable
                columns={[
                  { key: 'currency', label: 'Currency' },
                  { key: 'invoices', label: 'Invoices', num: true },
                  { key: 'invoiced', label: 'Invoiced', num: true, render: (r) => money(r.invoiced as string, String(r.currency)) },
                  { key: 'received', label: 'Received', num: true, render: (r) => money(r.received as string, String(r.currency)) },
                  { key: 'pending', label: 'Pending', num: true, render: (r) => money(r.pending as string, String(r.currency)) },
                  { key: 'avg_rate', label: 'Avg ₹/unit', num: true },
                  { key: 'invoiced_inr', label: 'Invoiced (₹)', num: true, render: (r) => inr(r.invoiced_inr as string) },
                ]}
                rows={d.byCurrency as unknown as Record<string, unknown>[]}
              />
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Recorded sale-side charges" subtitle="Freight / insurance / shipping / discount (not procurement cost)">
                <div className="space-y-2 pt-1">
                  {([['FOB value', t.fob_inr], ['Ocean freight', t.freight_inr], ['Insurance', t.insurance_inr], ['Shipping charges', t.shipping_inr], ['Discount given', t.discount_inr]] as const).map(([label, v]) => (
                    <div key={label} className="flex justify-between border-b border-slate-50 pb-1.5 text-[13px]">
                      <span className="text-slate-500">{label}</span>
                      <span className="tabular-nums text-slate-700">{inr(v)}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-slate-400">Procurement / milling cost isn't recorded, so this is the sale side only — not full profit.</p>
                </div>
              </Panel>
              <Panel title="Market reference rates" subtitle="Latest fetched ₹ per unit">
                <SimpleTable
                  columns={[
                    { key: 'currency_code', label: 'Currency' },
                    { key: 'rate_to_inr', label: '₹ / unit', num: true, render: (r) => num(r.rate_to_inr).toLocaleString('en-IN', { maximumFractionDigits: 4 }) },
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
