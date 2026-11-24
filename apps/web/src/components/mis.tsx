/**
 * Shared MIS building blocks — reused by every MIS page so the analytics section keeps the exact
 * look of the existing dashboard (same tiles, panels, palette). No new design language.
 */
import { formatAmount } from '@rmm/shared';
import type { ReactNode } from 'react';

export const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899', '#14b8a6'];

export const num = (v: unknown) => Number(v ?? 0);
/** INR money, compact for large values (K / L / Cr — Indian grouping). */
export const inr = (v: string | number) => `₹ ${formatAmount(String(v), 0)}`;
export const money = (v: string | number, cur = '') => `${cur ? cur + ' ' : ''}${formatAmount(String(v), 0)}`;
export const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
/** Short axis tick for INR: 12.3L, 4.5Cr. */
export const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
};

const TONES: Record<string, string> = {
  indigo: 'from-indigo-500 to-indigo-600',
  emerald: 'from-emerald-500 to-emerald-600',
  amber: 'from-amber-500 to-amber-600',
  sky: 'from-sky-500 to-sky-600',
  violet: 'from-violet-500 to-violet-600',
  rose: 'from-rose-500 to-rose-600',
  teal: 'from-teal-500 to-teal-600',
  slate: 'from-slate-500 to-slate-600',
};

export function Kpi({
  label,
  value,
  sub,
  icon,
  tone,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  tone: keyof typeof TONES;
  trend?: number | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium tracking-wide text-slate-400 uppercase">{label}</div>
          <div className="mt-1 truncate text-[22px] leading-tight font-semibold text-slate-900 tabular-nums">{value}</div>
          {(sub || trend != null) && (
            <div className="mt-1 flex items-center gap-1 text-[11.5px] text-slate-400">
              {trend != null && (
                <span className={`font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
                </span>
              )}
              {sub && <span>{sub}</span>}
            </div>
          )}
        </div>
        {icon && <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white ${TONES[tone]}`}>{icon}</span>}
      </div>
    </div>
  );
}

export function Panel({ title, subtitle, children, className = '', right }: { title: string; subtitle?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="text-[11.5px] text-slate-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Honest empty state — shown when a panel's data isn't recorded yet (never faked). */
export function NoData({ label = 'No data for this selection' }: { label?: string }) {
  return <div className="flex h-[200px] items-center justify-center text-[13px] text-slate-400">{label}</div>;
}
