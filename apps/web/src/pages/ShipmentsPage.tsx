import { formatAmount, type PipelineView } from '@rmm/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Check, Container, PackageCheck, Search, Ship } from 'lucide-react';
import { CheckpointPath, CheckpointSummary } from '../components/Checkpoints';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

interface Shipment {
  id: string;
  lotNo: number;
  market: string;
  quantityMt: string;
  containerCount: number;
  targetShipDate: string | null;
  status: string;
  piId: string;
  piNumber: string | null;
  buyer: string | null;
  currency: string | null;
  chargeTotal: string;
  pipeline: PipelineView;
}

const STATUS: Record<string, string> = {
  PLANNED: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-sky-100 text-sky-700',
  SHIPPED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-700',
};
const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');
const num = (v: unknown) => Number(v ?? 0);

export function ShipmentsPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['shipments', 'list'], queryFn: () => api.get<Shipment[]>('/shipments'), enabled: !!session?.activeCompany });
  const [search, setSearch] = useState('');
  const [market, setMarket] = useState('');
  const [status, setStatus] = useState('');
  const [attention, setAttention] = useState(false);
  /** Lot needs attention: overdue checkpoints, or work done out of order. */
  const needsAttention = (r: Shipment) => r.status !== 'CANCELLED' && r.status !== 'SHIPPED' && (r.pipeline.overdue > 0 || r.pipeline.steps.some((x) => x.outOfOrder));

  const all = q.data ?? [];
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!market || r.market === market) &&
        (!status || r.status === status) &&
        (!attention || needsAttention(r)) &&
        (!t || `${r.piNumber ?? ''} ${r.buyer ?? ''}`.toLowerCase().includes(t)),
    );
  }, [all, search, market, status, attention]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status !== 'CANCELLED');
    return {
      lots: rows.length,
      mt: active.reduce((a, r) => a + num(r.quantityMt), 0),
      shipped: rows.filter((r) => r.status === 'SHIPPED').length,
      inProgress: rows.filter((r) => r.status === 'IN_PROGRESS').length,
      avg: active.length ? Math.round(active.reduce((a, r) => a + (r.pipeline?.percent ?? 0), 0) / active.length) : 0,
      overdue: active.reduce((a, r) => a + (r.status === 'SHIPPED' ? 0 : r.pipeline.overdue), 0),
      attention: active.filter(needsAttention).length,
    };
  }, [rows]);

  // group by order (PI)
  const groups = useMemo(() => {
    const m = new Map<string, { piId: string; piNumber: string | null; buyer: string | null; lots: Shipment[] }>();
    for (const r of rows) {
      const g = m.get(r.piId) ?? { piId: r.piId, piNumber: r.piNumber, buyer: r.buyer, lots: [] };
      g.lots.push(r);
      m.set(r.piId, g);
    }
    return [...m.values()].map((g) => ({ ...g, lots: g.lots.sort((a, b) => a.lotNo - b.lotNo) }));
  }, [rows]);

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <PageHeader title="Shipments" subtitle={`${session.activeCompany.name} · lots & live pipeline status`} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {/* stats */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Stat label="Lots" value={String(stats.lots)} icon={<Boxes className="size-4" />} tone="indigo" />
          <Stat label="Planned MT" value={formatAmount(String(stats.mt), 3)} icon={<Container className="size-4" />} tone="sky" />
          <Stat label="In progress" value={String(stats.inProgress)} icon={<Ship className="size-4" />} tone="amber" />
          <Stat label="Shipped" value={String(stats.shipped)} icon={<PackageCheck className="size-4" />} tone="emerald" />
          <Stat label="Avg checkpoints" value={`${stats.avg}%`} icon={<Check className="size-4" />} tone="violet" />
          <button type="button" onClick={() => setAttention((a) => !a)} className="text-left" title="Show only lots with overdue or out-of-order checkpoints">
            <Stat label={attention ? 'Needs attention ✓' : 'Needs attention'} value={`${stats.attention} lots · ${stats.overdue} late`} icon={<AlertTriangle className="size-4" />} tone="rose" />
          </button>
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <input className="field-input pl-8" placeholder="Search order or buyer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="field-input w-auto" value={market} onChange={(e) => setMarket(e.target.value)}>
            <option value="">All markets</option>
            <option value="GULF">Gulf</option>
            <option value="EU">EU</option>
          </select>
          <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['PLANNED', 'IN_PROGRESS', 'SHIPPED', 'CANCELLED'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
            <input type="checkbox" className="accent-brand-700" checked={attention} onChange={(e) => setAttention(e.target.checked)} />
            Needs attention only
          </label>
          {(search || market || status || attention) && (
            <button type="button" className="text-[12.5px] text-slate-500 hover:text-slate-800" onClick={() => { setSearch(''); setMarket(''); setStatus(''); setAttention(false); }}>Clear</button>
          )}
        </div>

        {groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-slate-500">
            No shipments. Open a proforma invoice and use “Plan shipments”.
          </div>
        ) : (
          groups.map((g) => {
            const gMt = g.lots.filter((l) => l.status !== 'CANCELLED').reduce((a, l) => a + num(l.quantityMt), 0);
            const gPct = g.lots.length ? Math.round(g.lots.reduce((a, l) => a + (l.pipeline?.percent ?? 0), 0) / g.lots.length) : 0;
            return (
              <section key={g.piId} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2.5">
                  <button type="button" onClick={() => navigate(`/plan/${g.piId}`)} className="font-mono text-[13px] font-semibold text-brand-700 hover:underline">{g.piNumber ?? '—'}</button>
                  <span className="text-[13px] text-slate-600">{g.buyer ?? '—'}</span>
                  <span className="ml-auto text-[12px] text-slate-400">{g.lots.length} lot{g.lots.length === 1 ? '' : 's'} · {formatAmount(String(gMt), 3)} MT · {gPct}% avg</span>
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                  {g.lots.map((r) => <LotTile key={r.id} r={r} onOpen={() => navigate(`/plan/${r.piId}`)} />)}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function LotTile({ r, onOpen }: { r: Shipment; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="rounded-lg border border-slate-200 bg-white p-3 text-left transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-800">Lot {r.lotNo}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${r.market === 'EU' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.market === 'EU' ? 'EU' : 'Gulf'}</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[r.status] ?? 'bg-slate-100 text-slate-600'}`}>{statusLabel(r.status)}</span>
      </div>
      <div className="mb-2 grid grid-cols-3 gap-2 text-[12px]">
        <div><div className="text-[10px] tracking-wide text-slate-400 uppercase">Qty</div><div className="font-medium tabular-nums text-slate-700">{formatAmount(r.quantityMt, 3)}</div></div>
        <div><div className="text-[10px] tracking-wide text-slate-400 uppercase">Cntr</div><div className="font-medium tabular-nums text-slate-700">{r.containerCount || '—'}</div></div>
        <div><div className="text-[10px] tracking-wide text-slate-400 uppercase">Charges</div><div className="font-medium tabular-nums text-slate-700">{r.currency ?? ''} {formatAmount(r.chargeTotal, 0)}</div></div>
      </div>
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{r.targetShipDate ? `Ship ${r.targetShipDate}` : 'No ship date — set one to plan checkpoints'}</span>
        <span className="font-medium text-slate-500">{r.pipeline.done}/{r.pipeline.total}</span>
      </div>
      <div className="mb-1.5">
        <CheckpointPath p={r.pipeline} />
      </div>
      <CheckpointSummary p={r.pipeline} />
    </button>
  );
}

const TONES: Record<string, string> = { rose: 'from-rose-500 to-rose-600', indigo: 'from-indigo-500 to-indigo-600', sky: 'from-sky-500 to-sky-600', amber: 'from-amber-500 to-amber-600', emerald: 'from-emerald-500 to-emerald-600', violet: 'from-violet-500 to-violet-600' };
function Stat({ label, value, icon, tone }: { label: string; value: string; icon: ReactNode; tone: keyof typeof TONES }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <span className={`flex size-9 items-center justify-center rounded-lg bg-gradient-to-br text-white ${TONES[tone]}`}>{icon}</span>
      <div>
        <div className="text-[11px] tracking-wide text-slate-400 uppercase">{label}</div>
        <div className="text-[18px] leading-tight font-semibold text-slate-900 tabular-nums">{value}</div>
      </div>
    </div>
  );
}
