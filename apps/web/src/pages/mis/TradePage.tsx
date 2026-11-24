import { Donut, HBar, MisPage, SimpleTable } from '../../components/MisPage';
import { num, Panel } from '../../components/mis';

interface Trade {
  byCountry: { country: string; id: string | null; region: string; revenue: string; invoices: number; buyers: number; volume_mt: string }[];
  byPort: { port: string; country: string; revenue: string; invoices: number }[];
  byIncoterm: { incoterm: string; count: number; revenue: string }[];
}
const mt = (v: number) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT`;

export function TradePage() {
  return (
    <MisPage<Trade> title="Trade analytics" path="/mis/trade" subtitle="Export markets by destination, port & incoterm">
      {(d, f) => (
        <>
          <div className="grid gap-4 lg:grid-cols-5">
            <Panel title="Revenue by destination" subtitle={`${f.ccy} per country · click to filter`} className="lg:col-span-3">
              <HBar data={d.byCountry.slice(0, 10).map((c) => ({ name: c.country, value: num(c.revenue), pick: c.id ?? '' }))} fmt={(v) => f.fmt(v)} onPick={(v) => f.set('destinationCountryId', v)} />
            </Panel>
            <Panel title="Incoterm mix" subtitle="By revenue" className="lg:col-span-2">
              <Donut data={d.byIncoterm.map((i) => ({ name: i.incoterm, value: num(i.revenue) }))} fmt={(v) => f.fmt(v)} />
            </Panel>
          </div>
          <Panel title="Destination countries" subtitle="Revenue, volume and buyer reach · click a row to filter">
            <SimpleTable
              columns={[
                { key: 'country', label: 'Country' },
                { key: 'region', label: 'Region' },
                { key: 'revenue', label: `Revenue (${f.sym})`, num: true, render: (r) => f.fmt(r.revenue as string) },
                { key: 'volume_mt', label: 'Volume', num: true, render: (r) => mt(num(r.volume_mt)) },
                { key: 'invoices', label: 'Invoices', num: true },
                { key: 'buyers', label: 'Buyers', num: true },
              ]}
              rows={d.byCountry as unknown as Record<string, unknown>[]}
              onRow={(r) => r.id && f.set('destinationCountryId', String(r.id))}
            />
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Top discharge ports" subtitle="Where goods land">
              <HBar data={d.byPort.slice(0, 8).map((p) => ({ name: p.port, value: num(p.revenue) }))} fmt={(v) => f.tick(v)} />
            </Panel>
            <Panel title="Ports detail">
              <SimpleTable
                columns={[
                  { key: 'port', label: 'Port' },
                  { key: 'country', label: 'Country' },
                  { key: 'revenue', label: `Revenue (${f.sym})`, num: true, render: (r) => f.fmt(r.revenue as string) },
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
