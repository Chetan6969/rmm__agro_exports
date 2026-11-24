/**
 * Export Overview — the MIS landing page. Headline KPIs + charts, all driven by the shared
 * GlobalFilterBar. Revenue is shown in INR (normalised via each invoice's transaction rate); the
 * per-currency receivables table keeps the untouched figures.
 */
import { formatAmount } from '@rmm/shared';
import { useQuery } from '@tanstack/react-query';
import { Boxes, FileText, Gauge, Globe2, PackageCheck, Ship, TrendingUp, Users, Wallet } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GlobalFilterBar } from '../components/GlobalFilterBar';
import { COLORS, compact, inr, Kpi, money, monthLabel, NoData, num, Panel, statusLabel } from '../components/mis';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useMisFilter } from '../lib/useMisFilter';

interface Overview {
  kpis: {
    revenueInr: string;
    receivedInr: string;
    volumeMt: string;
    avgPricePerMt: string;
    invoices: number;
    activeBuyers: number;
    countries: number;
    orders: number;
    activeContracts: number;
    shipmentsPending: number;
    shipmentsCompleted: number;
    shipmentsTotal: number;
    growthPct: number | null;
  };
  monthly: { month: string; revenue: string; received: string }[];
  byCountry: { country: string; revenue: string; invoices: number }[];
  byVariety: { variety: string; volume_mt: string; revenue: string }[];
  orderStatus: { status: string; count: number }[];
  receivables: { currency: string; count: number; invoiced: string; received: string; pending: string }[];
}

const mt = (v: string | number) => `${formatAmount(String(v), 3)} MT`;

export function DashboardPage() {
  const { session } = useSession();
  const f = useMisFilter();
  const enabled = !!session?.activeCompany;
  const q = useQuery({ queryKey: ['mis', 'overview', f.query], queryFn: () => api.get<Overview>(`/mis/overview${f.query}`), enabled });

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;

  const d = q.data;
  const k = d?.kpis;
  const collected = k && num(k.revenueInr) > 0 ? Math.round((num(k.receivedInr) / num(k.revenueInr)) * 100) : 0;
  const monthly = (d?.monthly ?? []).map((m) => ({ month: monthLabel(m.month), Revenue: num(m.revenue), Received: num(m.received) }));
  const byCountry = (d?.byCountry ?? []).slice(0, 8).map((c) => ({ name: c.country, value: num(c.revenue), invoices: c.invoices }));
  const byVariety = (d?.byVariety ?? []).map((v) => ({ name: v.variety, value: num(v.volume_mt), revenue: num(v.revenue) }));
  const orderStatus = (d?.orderStatus ?? []).map((s) => ({ name: statusLabel(s.status), value: s.count }));

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
      <PageHeader title="Export overview" subtitle={`${session.activeCompany.name} · analytics & receivables`} />
      <GlobalFilterBar f={f} enabled={enabled} />
      <div className="flex-1 overflow-y-auto">
        {q.isLoading || !d ? (
          q.error ? <div className="p-6"><ErrorBox error={q.error} /></div> : <Spinner label="Loading overview…" />
        ) : (
          <div className="space-y-4 p-4 sm:p-5">
            {/* KPI tiles */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Export revenue" value={inr(k!.revenueInr)} icon={<TrendingUp className="size-5" />} tone="indigo" trend={k!.growthPct} sub="vs prev. month" />
              <Kpi label="Received" value={inr(k!.receivedInr)} icon={<Wallet className="size-5" />} tone="emerald" sub={`${collected}% collected`} />
              <Kpi label="Volume shipped" value={mt(k!.volumeMt)} icon={<Boxes className="size-5" />} tone="sky" sub={`avg ${inr(k!.avgPricePerMt)}/MT`} />
              <Kpi label="Invoices" value={String(k!.invoices)} icon={<FileText className="size-5" />} tone="violet" sub="commercial invoices" />
              <Kpi label="Orders" value={String(k!.orders)} icon={<PackageCheck className="size-5" />} tone="amber" sub={`${k!.activeContracts} active contracts`} />
              <Kpi label="Active buyers" value={String(k!.activeBuyers)} icon={<Users className="size-5" />} tone="rose" sub={`${k!.countries} destinations`} />
              <Kpi label="Shipments" value={String(k!.shipmentsTotal)} icon={<Ship className="size-5" />} tone="teal" sub={`${k!.shipmentsPending} in progress · ${k!.shipmentsCompleted} shipped`} />
              <Kpi label="Destinations" value={String(k!.countries)} icon={<Globe2 className="size-5" />} tone="slate" sub="countries served" />
            </div>

            {/* monthly trend + country */}
            <div className="grid gap-4 lg:grid-cols-5">
              <Panel title="Monthly revenue & collections" subtitle="INR, normalised at each invoice's rate" className="lg:col-span-3">
                {monthly.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={monthly} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
                        <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                      <Tooltip formatter={(v: number) => inr(v)} />
                      <Area type="monotone" dataKey="Revenue" stroke="#6366f1" strokeWidth={2} fill="url(#gRev)" />
                      <Area type="monotone" dataKey="Received" stroke="#10b981" strokeWidth={2} fill="url(#gRec)" />
                      <Legend verticalAlign="top" height={24} iconType="circle" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <NoData />}
              </Panel>

              <Panel title="Revenue by destination" subtitle="Top export markets (INR)" className="lg:col-span-2">
                {byCountry.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={byCountry} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={compact} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={88} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => inr(v)} />
                      <Bar dataKey="value" name="Revenue" radius={[0, 6, 6, 0]} maxBarSize={22}>
                        {byCountry.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <NoData />}
              </Panel>
            </div>

            {/* variety + order status + collection */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="Volume by variety" subtitle="MT shipped per rice variety">
                {byVariety.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={byVariety} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2} stroke="none">
                        {byVariety.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => mt(v)} />
                      <Legend verticalAlign="bottom" height={24} iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <NoData />}
              </Panel>

              <Panel title="Orders by status" subtitle="Proforma (contract) pipeline">
                {orderStatus.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={orderStatus} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={28} />
                      <Tooltip cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="value" name="Orders" radius={[6, 6, 0, 0]} maxBarSize={48}>
                        {orderStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <NoData />}
              </Panel>

              <Panel title="Collections" subtitle="Received vs outstanding (INR)">
                {num(k!.revenueInr) > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={[{ name: 'Received', value: num(k!.receivedInr) }, { name: 'Outstanding', value: Math.max(0, num(k!.revenueInr) - num(k!.receivedInr)) }]} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2} stroke="none">
                          <Cell fill="#10b981" />
                          <Cell fill="#f59e0b" />
                        </Pie>
                        <Tooltip formatter={(v: number) => inr(v)} />
                        <Legend verticalAlign="bottom" height={24} iconType="circle" />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="-mt-[158px] mb-[118px] text-center">
                      <div className="text-2xl font-semibold text-slate-900">{collected}%</div>
                      <div className="text-[11px] tracking-wide text-slate-400 uppercase">collected</div>
                    </div>
                  </>
                ) : <NoData />}
              </Panel>
            </div>

            {/* receivables by currency */}
            {(d.receivables?.length ?? 0) > 0 && (
              <Panel title="Receivables by currency" subtitle="Actual billed figures (not converted)">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {d.receivables.map((r) => (
                    <div key={r.currency} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                      <div className="mb-1 text-[12px] font-semibold text-slate-700">{r.currency} · {r.count} invoices</div>
                      <div className="flex justify-between text-[12.5px]"><span className="text-slate-500">Invoiced</span><span className="tabular-nums">{money(r.invoiced, r.currency)}</span></div>
                      <div className="flex justify-between text-[12.5px]"><span className="text-slate-500">Received</span><span className="tabular-nums text-emerald-600">{money(r.received, r.currency)}</span></div>
                      <div className="flex justify-between text-[12.5px] font-medium"><span className="text-slate-500">Pending</span><span className="tabular-nums text-amber-600">{money(r.pending, r.currency)}</span></div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
