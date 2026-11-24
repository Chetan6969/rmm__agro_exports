/**
 * Shared scaffold for every MIS analytics page: page header + GlobalFilterBar + data fetch, with the
 * same loading / error / empty handling. Plus small Recharts + table helpers so each page stays short
 * and visually consistent with the existing dashboard.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { useMisFilter, type MisFilterApi } from '../lib/useMisFilter';
import { useSession } from '../lib/session';
import { GlobalFilterBar } from './GlobalFilterBar';
import { COLORS, NoData } from './mis';
import { ErrorBox, PageHeader, Spinner } from './ui';

const ax = { fontSize: 11, fill: '#94a3b8' } as const;

export function MisPage<T>({ title, subtitle, path, extra, children }: { title: string; subtitle?: string; path: string; extra?: Record<string, string>; children: (d: T, f: MisFilterApi) => ReactNode }) {
  const { session } = useSession();
  const f = useMisFilter();
  const enabled = !!session?.activeCompany;
  const extraStr = extra ? Object.entries(extra).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
  const url = `${path}${f.query}${extraStr ? (f.query ? '&' : '?') + extraStr : ''}`;
  const q = useQuery({ queryKey: ['mis', path, url], queryFn: () => api.get<T>(url), enabled });

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      <PageHeader title={title} subtitle={subtitle ?? `${session.activeCompany.name} · MIS`} />
      <GlobalFilterBar f={f} enabled={enabled} />
      <div className="flex-1 overflow-y-auto">
        {q.isLoading || !q.data ? (
          q.error ? <div className="p-6"><ErrorBox error={q.error} /></div> : <Spinner label="Loading…" />
        ) : (
          <div className="space-y-4 p-4 sm:p-5">{children(q.data, f)}</div>
        )}
      </div>
    </div>
  );
}

type Pt = { name: string; value: number };

/** Horizontal bar chart (ranked categories). */
export function HBar({ data, fmt, height = 260, width = 110 }: { data: Pt[]; fmt: (v: number) => string; height?: number; width?: number }) {
  if (!data.length) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
        <XAxis type="number" tickFormatter={fmt} tick={ax} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={width} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => fmt(v)} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bar chart. */
export function VBar({ data, fmt, height = 240 }: { data: Pt[]; fmt: (v: number) => string; height?: number }) {
  if (!data.length) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="name" tick={ax} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={fmt} tick={ax} tickLine={false} axisLine={false} width={40} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => fmt(v)} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut chart with legend. */
export function Donut({ data, fmt, height = 240 }: { data: Pt[]; fmt: (v: number) => string; height?: number }) {
  if (!data.length || data.every((d) => !d.value)) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2} stroke="none">
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => fmt(v)} />
        <Legend verticalAlign="bottom" height={24} iconType="circle" />
      </PieChart>
    </ResponsiveContainer>
  );
}

export interface Col {
  key: string;
  label: string;
  num?: boolean;
  render?: (row: Record<string, unknown>) => ReactNode;
}

/** Compact data table matching the dashboard's style. */
export function SimpleTable({ columns, rows, empty = 'No data for this selection' }: { columns: Col[]; rows: Record<string, unknown>[]; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-400 uppercase">
            {columns.map((c) => <th key={c.key} className={`py-1.5 pr-3 ${c.num ? 'text-right' : ''}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className={`py-1.5 pr-3 ${c.num ? 'text-right tabular-nums text-slate-600' : 'text-slate-600'}`}>
                  {c.render ? c.render(r) : String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={columns.length} className="py-8 text-center text-slate-400">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
