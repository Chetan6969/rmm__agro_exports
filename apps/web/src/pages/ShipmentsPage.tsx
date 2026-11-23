import { formatAmount } from '@rmm/shared';
import { useQuery } from '@tanstack/react-query';
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
}

const STATUS: Record<string, string> = {
  PLANNED: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-sky-100 text-sky-700',
  SHIPPED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-700',
};
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');

export function ShipmentsPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['shipments', 'list'], queryFn: () => api.get<Shipment[]>('/shipments'), enabled: !!session?.activeCompany });

  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const rows = q.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Shipments" subtitle={`${session.activeCompany.name} · lots planned against orders`} />
      <div className="flex-1 overflow-auto p-3 sm:p-5">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No shipments planned yet. Open a proforma invoice and use “Plan shipments”.</div>
        ) : (
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11.5px] tracking-wide text-slate-500 uppercase">
                <th className="py-2 pr-2">Order</th>
                <th className="py-2 pr-2">Buyer</th>
                <th className="py-2 pr-2">Lot</th>
                <th className="py-2 pr-2">Market</th>
                <th className="py-2 pr-2 text-right">Qty (MT)</th>
                <th className="py-2 pr-2 text-right">Containers</th>
                <th className="py-2 pr-2">Target date</th>
                <th className="py-2 pr-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/plan/${r.piId}`)}>
                  <td className="py-1.5 pr-2 font-mono text-[12px] font-medium text-brand-700">{r.piNumber ?? '—'}</td>
                  <td className="max-w-48 truncate py-1.5 pr-2 text-slate-600">{r.buyer ?? '—'}</td>
                  <td className="py-1.5 pr-2 tabular-nums">Lot {r.lotNo}</td>
                  <td className="py-1.5 pr-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${r.market === 'EU' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>{r.market === 'EU' ? 'EU' : 'Gulf'}</span></td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatAmount(r.quantityMt, 3)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.containerCount || '—'}</td>
                  <td className="py-1.5 pr-2 text-slate-600">{r.targetShipDate ?? '—'}</td>
                  <td className="py-1.5 pr-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[r.status] ?? 'bg-slate-100 text-slate-600'}`}>{label(r.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
