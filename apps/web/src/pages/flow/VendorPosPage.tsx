import { formatAmount } from '@rmm/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/Modal';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { useDebounced } from '../MasterListPage';

interface Po {
  id: string;
  number: string;
  poDate: string;
  status: string;
  deliveryBy: string | null;
  totalAmount: string;
  lines: { description: string; quantity: number; unit: string }[];
  supplierName: string | null;
  orderId: string | null;
  orderNumber: string | null;
}
const TONE: Record<string, 'slate' | 'blue' | 'green' | 'red'> = { DRAFT: 'slate', SENT: 'blue', RECEIVED: 'green', CANCELLED: 'red' };

/** Packaging purchase orders (bags, inner packs, tags, strips, seals) made from order planning. */
export function VendorPosPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [sel, setSel] = useState(0);
  const [del, setDel] = useState<Po | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['vendor-pos', status, debounced], queryFn: () => api.get<Po[]>(`/vendor-pos${qs({ status, search: debounced })}`), placeholderData: keepPreviousData });
  const rows = q.data ?? [];
  const setPoStatus = async (po: Po, s: string) => {
    try {
      await api.put(`/vendor-pos/${po.id}`, { status: s });
      toast.success(`${po.number}: ${s.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ['vendor-pos'] });
    } catch (e) {
      showError(e);
    }
  };
  useHotkeys(
    {
      '/': () => searchRef.current?.focus(),
      arrowdown: () => setSel((i) => Math.min(i + 1, rows.length - 1)),
      arrowup: () => setSel((i) => Math.max(i - 1, 0)),
      enter: () => rows[sel] && window.open(`/api/vendor-pos/${rows[sel].id}/pdf`, '_blank', 'noopener'),
    },
    [rows, sel],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Packaging purchase orders" subtitle="Made from an order's plan (Plan shipments → Packaging to buy). Print, send to the supplier, and mark when the material arrives." />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} className="field-input pl-7" placeholder="PO no. or supplier…  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => ['ArrowDown', 'Escape', 'Enter'].includes(e.key) && (e.preventDefault(), e.currentTarget.blur())} aria-label="Search purchase orders" />
        </div>
        <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.keys(TONE).map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !rows.length ? (
          <Card className="p-8 text-center text-[13px] text-slate-500">No purchase orders yet. Open an order → Plan shipments → Packaging to buy → Create purchase orders.</Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-[12px] text-slate-500">
                <tr>
                  {['PO', 'Date', 'Supplier', 'Items', 'Order', 'Amount (₹)', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((po, i) => (
                  <tr key={po.id} onClick={() => setSel(i)} aria-selected={i === sel} className={`border-t border-slate-100 ${i === sel ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2">
                      <a href={`/api/vendor-pos/${po.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono font-medium text-brand-700 hover:underline">
                        <FileText className="size-3.5" /> {po.number}
                      </a>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{po.poDate}</td>
                    <td className="px-3 py-2">{po.supplierName}</td>
                    <td className="px-3 py-2 text-slate-600">{po.lines.map((l) => `${l.quantity.toLocaleString('en-IN')} ${l.description.split(' for ')[0]}`).join(', ')}</td>
                    <td className="px-3 py-2">{po.orderId ? <Link to={`/plan/${po.orderId}`} className="text-brand-700 hover:underline">{po.orderNumber}</Link> : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{formatAmount(po.totalAmount, 2)}</td>
                    <td className="px-3 py-2">
                      {can('sales.vendorPos', 'edit') ? (
                        <select className="field-input w-auto py-0.5 text-[12px]" value={po.status} onChange={(e) => setPoStatus(po, e.target.value)} aria-label={`Status of ${po.number}`}>
                          {Object.keys(TONE).map((s) => (
                            <option key={s} value={s}>
                              {s.toLowerCase()}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone={TONE[po.status]}>{po.status.toLowerCase()}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{can('sales.vendorPos', 'delete') && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(po)} aria-label={`Delete ${po.number}`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <div className="mt-2 text-[12px] text-slate-400 max-md:hidden">/ search · ↑ ↓ choose · Enter open the PDF</div>
      </div>
      <ConfirmDialog
        open={!!del}
        title={`Delete ${del?.number ?? ''}?`}
        message="It moves to the recycle bin; its packaging lines go back to 'to order'."
        confirmLabel="Delete"
        danger
        requireReason
        onClose={() => setDel(null)}
        onConfirm={async (reason) => {
          await api.del(`/vendor-pos/${del!.id}`, { reason });
          qc.invalidateQueries({ queryKey: ['vendor-pos'] });
        }}
      />
    </div>
  );
}
