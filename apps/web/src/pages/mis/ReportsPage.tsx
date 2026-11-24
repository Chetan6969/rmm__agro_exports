import { Download } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../lib/session';
import { MisPage, SimpleTable, type Col } from '../../components/MisPage';
import { num, Panel } from '../../components/mis';

interface Data {
  report: string;
  columns: Col[];
  rows: Record<string, unknown>[];
}
const DATASETS = [
  { key: 'invoices', label: 'Commercial invoices' },
  { key: 'lines', label: 'Invoice line items' },
  { key: 'orders', label: 'Orders (proforma)' },
  { key: 'payments', label: 'Receipts' },
  { key: 'shipments', label: 'Shipments' },
];

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function exportCsv(name: string, columns: Col[], rows: Record<string, unknown>[]) {
  const head = columns.map((c) => c.label).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(',')).join('\n');
  const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [report, setReport] = useState('invoices');
  const { can } = useSession();
  const canExport = can('mis.dashboard', 'export');
  return (
    <MisPage<Data> title="Custom reports" path="/mis/reports" extra={{ report }} subtitle="Filtered datasets over the real tables · export to CSV">
      {(d) => (
        <Panel
          title={DATASETS.find((x) => x.key === report)?.label ?? 'Report'}
          subtitle={`${d.rows.length} rows · respects the filter bar above`}
          right={
            <div className="flex items-center gap-2">
              <select value={report} onChange={(e) => setReport(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] text-slate-700 shadow-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-200 focus:outline-none">
                {DATASETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              {canExport && <button onClick={() => exportCsv(d.report, d.columns, d.rows)} disabled={!d.rows.length} className="flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[12.5px] font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-40">
                <Download className="size-3.5" /> CSV
              </button>}
            </div>
          }
        >
          <SimpleTable columns={d.columns.map((c) => ({ ...c, render: c.num ? (r: Record<string, unknown>) => num(r[c.key]).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : undefined }))} rows={d.rows} />
        </Panel>
      )}
    </MisPage>
  );
}
