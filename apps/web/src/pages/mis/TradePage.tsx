import { Donut, HBar, MisPage, SimpleTable } from '../../components/MisPage';
import { compact, inr, num, Panel } from '../../components/mis';

interface Trade {
  byCountry: { country: string; region: string; revenue: string; invoices: number; buyers: number; volume_mt: string }[];
  byPort: { port: string; country: string; revenue: string; invoices: number }[];
  byIncoterm: { incoterm: string; count: number; revenue: string }[];
}
const mt = (v: number) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT`;

export function TradePage() {
  return (
    <MisPage<Trade> title="Trade analytics" path="/mis/trade" subtitle="Export markets by destination, port & incoterm">
      {(d) => (
        <>
          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title="Revenue by destination" subtitle="INR per country" className="lg:col-span-3">
              <HBar data={d.byCountry.slice(0, 10).map((c) => ({ name: c.country, value: num(c.revenue) }))} fmt={(v) => inr(v)} />
            </Panel>
            <Panel title="Incoterm mix" subtitle="By revenue" className="lg:col-span-2">
              <Donut data={d.byIncoterm.map((i) => ({ name: i.incoterm, value: num(i.revenue) }))} fmt={(v) => inr(v)} />
            </Panel>
          </div>
          <Panel title="Destination countries" subtitle="Revenue, volume and buyer reach">
            <SimpleTable
              columns={[
                { key: 'country', label: 'Country' },
                { key: 'region', label: 'Region' },
                { key: 'revenue', label: 'Revenue (₹)', num: true, render: (r) => inr(r.revenue as string) },
                { key: 'volume_mt', label: 'Volume', num: true, render: (r) => mt(num(r.volume_mt)) },
                { key: 'invoices', label: 'Invoices', num: true },
                { key: 'buyers', label: 'Buyers', num: true },
              ]}
              rows={d.byCountry}
            />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Top discharge ports" subtitle="Where goods land">
              <HBar data={d.byPort.slice(0, 8).map((p) => ({ name: p.port, value: num(p.revenue) }))} fmt={(v) => compact(v)} />
            </Panel>
            <Panel title="Ports detail">
              <SimpleTable
                columns={[
                  { key: 'port', label: 'Port' },
                  { key: 'country', label: 'Country' },
                  { key: 'revenue', label: 'Revenue (₹)', num: true, render: (r) => inr(r.revenue as string) },
                  { key: 'invoices', label: 'Invoices', num: true },
                ]}
                rows={d.byPort}
              />
            </Panel>
          </div>
        </>
      )}
    </MisPage>
  );
}
