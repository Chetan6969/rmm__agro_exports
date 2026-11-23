import { formatAmount } from '@rmm/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, FileText, PackageCheck, TrendingUp, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

interface Summary {
  orders: { proforma: Status[]; production: Status[]; commercial: Status[] };
  receivables: { currency: string; count: number; invoiced: string; received: string; pending: string }[];
  monthly: { month: string; invoiced: string; received: string }[];
  pending: { id: string; number: string; date: string; buyer: string; currency: string; total: string; received: string; pending: string }[];
}
interface Status {
  status: string;
  count: number;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'];
const money = (v: string | number, cur = '') => `${cur ? cur + ' ' : ''}${formatAmount(String(v), 0)}`;
const num = (v: unknown) => Number(v ?? 0);
const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

export function DashboardPage() {
  const { session } = useSession();
  const q = useQuery({ queryKey: ['mis', 'summary'], queryFn: () => api.get<Summary>('/mis/summary'), enabled: !!session?.activeCompany });

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;
  if (q.isLoading) return <Spinner label="Loading dashboard…" />;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const d = q.data!;

  const primary = d.receivables[0] ?? { currency: '', count: 0, invoiced: '0', received: '0', pending: '0' };
  const openOrders = d.orders.proforma.filter((s) => s.status !== 'FULFILLED' && s.status !== 'CANCELLED').reduce((a, s) => a + s.count, 0);
  const invoices = d.orders.commercial.reduce((a, s) => a + s.count, 0);
  const pct = num(primary.invoiced) > 0 ? Math.round((num(primary.received) / num(primary.invoiced)) * 100) : 0;

  const donut = [
    { name: 'Received', value: num(primary.received) },
    { name: 'Pending', value: num(primary.pending) },
  ];
  const monthly = d.monthly.map((m) => ({ month: monthLabel(m.month), Invoiced: num(m.invoiced), Received: num(m.received) }));
  const ciStatus = d.orders.commercial.map((s) => ({ name: statusLabel(s.status), value: s.count }));

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <PageHeader title="MIS dashboard" subtitle={`${session.activeCompany.name} · live operations & receivables`} />
      <div className="space-y-4 p-4 sm:p-5">
        {/* KPI tiles */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Invoiced" value={money(primary.invoiced, primary.currency)} icon={<FileText className="size-5" />} tone="indigo" sub={`${primary.count} invoices`} />
          <Kpi label="Received" value={money(primary.received, primary.currency)} icon={<Wallet className="size-5" />} tone="emerald" sub={`${pct}% collected`} up />
          <Kpi label="Pending" value={money(primary.pending, primary.currency)} icon={<TrendingUp className="size-5" />} tone="amber" sub={`${d.pending.length} invoices open`} down />
          <Kpi label="Open orders" value={String(openOrders)} icon={<PackageCheck className="size-5" />} tone="sky" sub={`${invoices} invoices issued`} />
        </div>

        {/* charts */}
        <div className="grid gap-4 lg:grid-cols-5">
          <Panel title="Collection" subtitle={`${primary.currency} received vs pending`} className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none">
                  <Cell fill="#10b981" />
                  <Cell fill="#f59e0b" />
                </Pie>
                <Tooltip formatter={(v: number) => money(v, primary.currency)} />
                <Legend verticalAlign="bottom" height={24} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
            <div className="-mt-[150px] mb-[108px] text-center">
              <div className="text-2xl font-semibold text-slate-900">{pct}%</div>
              <div className="text-[11px] tracking-wide text-slate-400 uppercase">collected</div>
            </div>
          </Panel>

          <Panel title="Monthly trend" subtitle="Invoiced vs received" className="lg:col-span-3">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} width={44} />
                <Tooltip formatter={(v: number) => formatAmount(String(v), 0)} />
                <Area type="monotone" dataKey="Invoiced" stroke="#6366f1" strokeWidth={2} fill="url(#gInv)" />
                <Area type="monotone" dataKey="Received" stroke="#10b981" strokeWidth={2} fill="url(#gRec)" />
                <Legend verticalAlign="top" height={24} iconType="circle" />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-5">
          <Panel title="Invoices by status" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ciStatus} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={28} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="value" name="Invoices" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {ciStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Top pending receivables" subtitle="Highest outstanding invoices" className="lg:col-span-3">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-400 uppercase">
                    <th className="py-1.5 pr-2">Invoice</th>
                    <th className="py-1.5 pr-2">Buyer</th>
                    <th className="py-1.5 pr-2 text-right">Total</th>
                    <th className="py-1.5 pr-2 text-right">Received</th>
                    <th className="py-1.5 text-right">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pending.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-1.5 pr-2"><Link to={`/d/commercialInvoices/${r.id}`} className="font-mono text-[12px] font-medium text-brand-700 hover:underline">{r.number}</Link></td>
                      <td className="max-w-40 truncate py-1.5 pr-2 text-slate-600">{r.buyer}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{money(r.total, r.currency)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-600">{money(r.received)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-amber-600">{money(r.pending)}</td>
                    </tr>
                  ))}
                  {!d.pending.length && <tr><td colSpan={5} className="py-8 text-center text-slate-400">No pending receivables 🎉</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {d.receivables.length > 1 && (
          <Panel title="By currency" subtitle="Receivables across currencies">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.receivables.map((r) => (
                <div key={r.currency} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-1 text-[12px] font-semibold text-slate-700">{r.currency} · {r.count} invoices</div>
                  <div className="flex justify-between text-[12.5px]"><span className="text-slate-500">Invoiced</span><span className="tabular-nums">{money(r.invoiced)}</span></div>
                  <div className="flex justify-between text-[12.5px]"><span className="text-slate-500">Received</span><span className="tabular-nums text-emerald-600">{money(r.received)}</span></div>
                  <div className="flex justify-between text-[12.5px] font-medium"><span className="text-slate-500">Pending</span><span className="tabular-nums text-amber-600">{money(r.pending)}</span></div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  indigo: 'from-indigo-500 to-indigo-600',
  emerald: 'from-emerald-500 to-emerald-600',
  amber: 'from-amber-500 to-amber-600',
  sky: 'from-sky-500 to-sky-600',
};

function Kpi({ label, value, sub, icon, tone, up, down }: { label: string; value: string; sub?: string; icon: ReactNode; tone: keyof typeof TONES; up?: boolean; down?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11.5px] font-medium tracking-wide text-slate-400 uppercase">{label}</div>
          <div className="mt-1 text-[22px] leading-tight font-semibold text-slate-900 tabular-nums">{value}</div>
          {sub && (
            <div className="mt-1 flex items-center gap-0.5 text-[11.5px] text-slate-400">
              {up && <ArrowUpRight className="size-3 text-emerald-500" />}
              {down && <ArrowDownRight className="size-3 text-amber-500" />}
              {sub}
            </div>
          )}
        </div>
        <span className={`flex size-10 items-center justify-center rounded-lg bg-gradient-to-br text-white ${TONES[tone]}`}>{icon}</span>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3">
        <h2 className="text-[13px] font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-[11.5px] text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
