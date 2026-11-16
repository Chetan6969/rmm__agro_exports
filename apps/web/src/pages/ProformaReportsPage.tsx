import { formatAmount, PI_REPORT_FIELDS } from '@rmm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';

interface Usage {
  field: string;
  label: string;
  note: string;
  rows: { value: string; count: number; quantityMt: string; total: string }[];
}

/** PI analysis: how often each value of a field is used (the PR's "field usage" and "terms usage" reports). */
export function ProformaReportsPage() {
  const [field, setField] = useState<string>('buyerId');
  const usage = useQuery({ queryKey: ['reports', 'pi-field', field], queryFn: () => api.get<Usage>(`/documents/proformaInvoices/reports/field-usage?field=${field}`) });
  const terms = useQuery({ queryKey: ['reports', 'pi-terms'], queryFn: () => api.get<{ content: string; count: number }[]>('/documents/proformaInvoices/reports/terms-usage') });
  const maxCount = Math.max(1, ...(usage.data?.rows ?? []).map((r) => r.count));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Proforma invoice reports" subtitle="Active (not cancelled) proforma invoices of this company" />
      <div className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-xs">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label htmlFor="pi-field" className="text-[13px] font-medium text-slate-700">
              Group by
            </label>
            <select id="pi-field" className="field-input w-auto" value={field} onChange={(e) => setField(e.target.value)}>
              {PI_REPORT_FIELDS.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          {usage.isLoading ? (
            <Spinner />
          ) : usage.error ? (
            <ErrorBox error={usage.error} />
          ) : !usage.data?.rows.length ? (
            <div className="text-[13px] text-slate-500">No proforma invoices yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11.5px] text-slate-500 uppercase">
                    <th className="py-1.5 pr-2">{usage.data.label}</th>
                    <th className="py-1.5 pr-2 text-right">PIs</th>
                    <th className="w-40 py-1.5 pr-2" />
                    <th className="py-1.5 pr-2 text-right">Quantity (MT)</th>
                    <th className="py-1.5 pr-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.rows.map((r) => (
                    <tr key={r.value} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 font-medium text-slate-800">{r.value}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.count}</td>
                      <td className="py-1.5 pr-2">
                        <div className="h-2 rounded-sm bg-brand-600/80" style={{ width: `${(r.count / maxCount) * 100}%` }} />
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{formatAmount(r.quantityMt, 3)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{field === 'currencyId' ? `${formatAmount(r.total)} ${r.value}` : formatAmount(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {field !== 'currencyId' && <p className="mt-2 text-[11.5px] text-slate-400">Values add up amounts of all currencies; group by Currency for money totals.</p>}
            </div>
          )}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-xs">
          <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">Terms & conditions used</h2>
          {terms.isLoading ? (
            <Spinner />
          ) : terms.error ? (
            <ErrorBox error={terms.error} />
          ) : !terms.data?.length ? (
            <div className="text-[13px] text-slate-500">No terms on any proforma invoice yet.</div>
          ) : (
            <ul className="divide-y divide-slate-100 text-[13px]">
              {terms.data.map((t) => (
                <li key={t.content} className="flex gap-3 py-1.5">
                  <span className="w-12 shrink-0 text-right text-slate-500 tabular-nums">{t.count}×</span>
                  <span className="text-slate-800">{t.content}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
