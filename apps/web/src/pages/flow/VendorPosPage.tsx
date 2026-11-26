import { formatAmount, PURCHASE_CATEGORIES, PURCHASE_CATEGORY_KEYS, type PurchaseCategory } from '@rmm/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, ReceiptText, Search, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/Modal';
import { Chip, groupByOrder, OrderGroups } from '../../components/OrderGroups';
import { PurchaseInvoiceModal, PurchaseOrderModal } from '../../components/PurchaseForms';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { useDebounced } from '../MasterListPage';

interface Po {
  category: PurchaseCategory;
  billedAmount: string;
  orderSource: string | null;
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
  buyer: string | null;
}
const TONE: Record<string, 'slate' | 'blue' | 'green' | 'red'> = { DRAFT: 'slate', SENT: 'blue', RECEIVED: 'green', CANCELLED: 'red' };

/** Purchase orders to suppliers (packaging from order planning, paddy / rice, services), order by order. */
export function VendorPosPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [adding, setAdding] = useState(false);
  const [billFor, setBillFor] = useState<Po | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [del, setDel] = useState<Po | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['vendor-pos', status, category, debounced], queryFn: () => api.get<Po[]>(`/vendor-pos${qs({ status, category, search: debounced })}`), placeholderData: keepPreviousData });
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
      'alt+n': () => can('sales.vendorPos', 'create') && setAdding(true),
    },
    [],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Purchase orders"
        subtitle="Orders we place on suppliers: packaging (made from an order's plan or typed in), paddy / rice and services. Supplier bills are under Purchase invoices."
        actions={
          can('sales.vendorPos', 'create') && (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)} shortcut="alt+n">
              New purchase order
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} className="field-input pl-7" placeholder="PO no. or supplier…  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => ['ArrowDown', 'Escape', 'Enter'].includes(e.key) && (e.preventDefault(), e.currentTarget.blur())} aria-label="Search purchase orders" />
        </div>
        <select className="field-input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {PURCHASE_CATEGORY_KEYS.map((k) => (
            <option key={k} value={k}>
              {PURCHASE_CATEGORIES[k]}
            </option>
          ))}
        </select>
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
          <Card className="p-8 text-center text-[13px] text-slate-500">No purchase orders here. Press “New purchase order”, or open an order → Plan & packaging → Create purchase orders.</Card>
        ) : (
          <OrderGroups
            groups={groupByOrder(rows, (r) => ({ orderId: r.orderId, orderNumber: r.orderNumber, buyer: r.buyer, orderSource: r.orderSource }))}
            noOrderLabel="Not linked to an order"
            summary={(g) => (
              <>
                <Chip>
                  {g.items.length} PO(s) · ₹{formatAmount(String(g.items.reduce((a, p) => a + Number(p.totalAmount), 0)), 0)}
                </Chip>
                {g.items.some((p) => p.status === 'DRAFT') && <Chip tone="amber">{g.items.filter((p) => p.status === 'DRAFT').length} draft</Chip>}
              </>
            )}
          >
            {(g) => (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-left text-[12px] text-slate-500">
                    <tr>
                      {['PO', 'Date', 'Supplier', 'For', 'Items', 'Amount (₹)', 'Billed (₹)', 'Status', ''].map((h) => (
                        <th key={h} className="px-3 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((po) => (
                      <tr key={po.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <a href={`/api/vendor-pos/${po.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono font-medium text-brand-700 hover:underline">
                            <FileText className="size-3.5" /> {po.number}
                          </a>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{po.poDate}</td>
                        <td className="px-3 py-2">{po.supplierName}</td>
                        <td className="px-3 py-2 text-slate-600">{PURCHASE_CATEGORIES[po.category]}</td>
                        <td className="px-3 py-2 text-slate-600">{po.lines.map((l) => `${l.quantity.toLocaleString('en-IN')} ${l.description.split(' for ')[0]}`).join(', ')}</td>
                        <td className="px-3 py-2 tabular-nums">{formatAmount(po.totalAmount, 2)}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {Number(po.billedAmount) ? formatAmount(po.billedAmount, 2) : <span className="text-slate-400">no bill</span>}
                          {can('sales.purchaseInvoices', 'create') && po.status !== 'CANCELLED' && (
                            <Button variant="ghost" icon={<ReceiptText className="size-3.5" />} onClick={() => setBillFor(po)} aria-label={`Enter the bill for ${po.number}`} title="Enter the supplier's bill" />
                          )}
                        </td>
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
              </div>
            )}
          </OrderGroups>
        )}
      </div>
      {adding && <PurchaseOrderModal onClose={() => setAdding(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['vendor-pos'] })} />}
      {billFor && <PurchaseInvoiceModal order={billFor.orderId ? { id: billFor.orderId, label: billFor.orderNumber ?? '' } : undefined} onClose={() => setBillFor(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['vendor-pos'] })} />}
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
