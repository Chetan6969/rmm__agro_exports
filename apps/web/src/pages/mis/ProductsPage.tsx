import { Donut, HBar, MisPage, SimpleTable, VBar } from '../../components/MisPage';
import { inr, num, Panel } from '../../components/mis';

interface Dim {
  label: string;
  volume_mt: string;
  revenue: string;
  bags: number;
}
interface Data {
  byVariety: Dim[];
  byProcessing: Dim[];
  byGrade: Dim[];
  byCropYear: Dim[];
  byProduct: Dim[];
}
const mt = (v: number) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} MT`;
const pt = (d: Dim[]) => d.map((x) => ({ name: x.label, value: num(x.volume_mt) }));

export function ProductsPage() {
  return (
    <MisPage<Data> title="Product analytics" path="/mis/products" subtitle="Volume & revenue by variety, processing, grade and crop year">
      {(d) => (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Volume by variety" subtitle="MT"><Donut data={pt(d.byVariety)} fmt={(v) => mt(v)} /></Panel>
            <Panel title="By processing type" subtitle="MT"><Donut data={pt(d.byProcessing)} fmt={(v) => mt(v)} /></Panel>
            <Panel title="By grade" subtitle="MT"><VBar data={pt(d.byGrade)} fmt={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))} /></Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By crop year" subtitle="MT shipped"><HBar data={pt(d.byCropYear)} fmt={(v) => mt(v)} height={220} width={90} /></Panel>
            <Panel title="Top products" subtitle="By volume">
              <SimpleTable
                columns={[
                  { key: 'label', label: 'Product' },
                  { key: 'volume_mt', label: 'Volume', num: true, render: (r) => mt(num(r.volume_mt)) },
                  { key: 'bags', label: 'Bags', num: true, render: (r) => num(r.bags).toLocaleString('en-IN') },
                  { key: 'revenue', label: 'Revenue (₹)', num: true, render: (r) => inr(r.revenue as string) },
                ]}
                rows={d.byProduct as unknown as Record<string, unknown>[]}
              />
            </Panel>
          </div>
        </>
      )}
    </MisPage>
  );
}
