'use client';

import React, { useEffect, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { api, type FieldUsage } from '../../lib/api';

const FIELDS: { value: string; label: string }[] = [
  { value: 'paymentTerms', label: 'Payment terms' },
  { value: 'incoterm', label: 'Incoterms' },
  { value: 'currency', label: 'Currency' },
  { value: 'brand', label: 'Brand' },
  { value: 'portOfLoading', label: 'Loading port' },
  { value: 'portOfDischarge', label: 'Discharge port' },
  { value: 'finalDestination', label: 'Destination' },
  { value: 'specCropYear', label: 'Crop year' },
  { value: 'status', label: 'Status' },
];

export function ProformaReports() {
  const [field, setField] = useState('paymentTerms');
  const [data, setData] = useState<FieldUsage | null>(null);
  const [termsUsage, setTermsUsage] = useState<{ value: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.proformaFieldUsage(field), api.proformaTermsUsage()])
      .then(([f, t]) => {
        if (!active) return;
        setData(f);
        setTermsUsage(t);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [field]);

  const maxCount = Math.max(1, ...(data?.rows.map((r) => r.count) || [1]));
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-blue-700" />
        <h2 className="font-bold text-slate-800">Proforma field reports</h2>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>
      <p className="text-xs text-slate-500 -mt-2">
        Every field on a proforma is its own entity — pick one and see how it is
        used across all PIs (count &amp; total value).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="ef-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <label className="ef-label mb-0">Group by</label>
            <select
              className="ef-select w-auto"
              value={field}
              onChange={(e) => setField(e.target.value)}
            >
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            {(data?.rows.length ?? 0) === 0 && (
              <div className="text-xs text-slate-400 py-6 text-center">No data yet.</div>
            )}
            {data?.rows.map((r) => (
              <div key={r.value}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-slate-700 truncate pr-2" title={r.value}>{r.value}</span>
                  <span className="font-mono text-slate-500 shrink-0">
                    {r.count}× · {data.field === 'status' ? '' : '$'}{fmt(r.totalAmount)}
                  </span>
                </div>
                <div className="h-2.5 rounded bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded bg-blue-600"
                    style={{ width: `${(r.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="ef-card p-4">
          <div className="ef-section-title mb-3">Most-used Terms &amp; Conditions</div>
          <div className="space-y-2">
            {termsUsage.length === 0 && (
              <div className="text-xs text-slate-400 py-6 text-center">No terms used yet.</div>
            )}
            {termsUsage.map((t, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-slate-700 leading-snug">{t.value}</span>
                <span className="font-mono text-blue-700 font-semibold shrink-0">{t.count}×</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
