import { FileCheck2, FileStack, Ship, ScrollText } from 'lucide-react';
import { Link } from 'react-router';
import { HBar, MisPage, SimpleTable } from '../../components/MisPage';
import { Kpi, num, Panel, statusLabel } from '../../components/mis';

interface Data {
  summary: { total: number; with_po: number; with_ci: number; with_obl: number };
  certsByTemplate: { name: string; count: number }[];
  checklist: { id: string; pi_id: string; order_no: string; buyer: string; market: string; status: string; po: boolean; ci: boolean; obl: boolean; certs: number; stages_done: number }[];
}
const mark = (ok: boolean) => (ok ? <span className="font-semibold text-emerald-600">✓</span> : <span className="text-slate-300">✗</span>);

export function DocumentationPage() {
  return (
    <MisPage<Data> title="Documentation & compliance" path="/mis/documentation" subtitle="Per-shipment document completeness">
      {(d) => {
        const s = d.summary;
        const certTotal = d.certsByTemplate.reduce((a, c) => a + num(c.count), 0);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Shipments" value={String(s.total)} icon={<Ship className="size-5" />} tone="indigo" />
              <Kpi label="With invoice" value={`${s.with_ci}/${s.total}`} icon={<FileCheck2 className="size-5" />} tone="emerald" />
              <Kpi label="With ocean bill" value={`${s.with_obl}/${s.total}`} icon={<FileStack className="size-5" />} tone="sky" />
              <Kpi label="Certificates" value={String(certTotal)} icon={<ScrollText className="size-5" />} tone="amber" sub={`${d.certsByTemplate.length} types`} />
            </div>
            <Panel title="Certificates by template" subtitle="How many of each generated">
              {d.certsByTemplate.length ? <HBar data={d.certsByTemplate.map((c) => ({ name: c.name, value: num(c.count) }))} fmt={(v) => String(Math.round(v))} height={220} width={150} /> : <div className="flex h-[180px] items-center justify-center text-[13px] text-slate-400">No certificates generated yet</div>}
            </Panel>
            <Panel title="Document checklist" subtitle="✓ present · ✗ missing — per shipment">
              <SimpleTable
                columns={[
                  { key: 'order_no', label: 'Order', render: (r) => <Link to={`/d/proformaInvoices/${r.pi_id}`} className="font-mono text-[12px] font-medium text-brand-700 hover:underline">{String(r.order_no)}</Link> },
                  { key: 'buyer', label: 'Buyer' },
                  { key: 'market', label: 'Market' },
                  { key: 'status', label: 'Status', render: (r) => statusLabel(String(r.status)) },
                  { key: 'po', label: 'Prod. order', num: true, render: (r) => mark(!!r.po) },
                  { key: 'ci', label: 'Invoice', num: true, render: (r) => mark(!!r.ci) },
                  { key: 'obl', label: 'Ocean bill', num: true, render: (r) => mark(!!r.obl) },
                  { key: 'certs', label: 'Certs', num: true },
                  { key: 'stages_done', label: 'Steps done', num: true },
                ]}
                rows={d.checklist as unknown as Record<string, unknown>[]}
              />
            </Panel>
          </>
        );
      }}
    </MisPage>
  );
}
