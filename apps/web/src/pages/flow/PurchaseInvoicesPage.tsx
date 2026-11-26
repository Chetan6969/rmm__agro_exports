/** Purchase invoices — the bills suppliers send us, order by order. Never mixed with our export invoices. */
import { formatAmount, PURCHASE_CATEGORIES, PURCHASE_CATEGORY_KEYS } from '@rmm/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Paperclip, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/Modal';
import { Chip, groupByOrder, OrderGroups } from '../../components/OrderGroups';
import { PurchaseInvoiceModal, type PurchaseInvoiceRow } from '../../components/PurchaseForms';
import { Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { useSession } from '../../lib/session';
import { useDebounced } from '../MasterListPage';

export const PAY_LABEL = { UNPAID: 'unpaid', PART: 'part paid', PAID: 'paid' } as const;
export const PAY_CHIP = { UNPAID: 'amber', PART: 'blue', PAID: 'green' } as const;
const money = (rows: PurchaseInvoiceRow[], k: 'totalAmount' | 'paidAmount') => rows.reduce((s, r) => s + Number(r[k]), 0);

/** The bills table, used here and inside an order file. */
export function BillTable({ rows, onEdit, onDelete }: { rows: PurchaseInvoiceRow[]; onEdit?: (r: PurchaseInvoiceRow) => void; onDelete?: (r: PurchaseInvoiceRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[12px] text-slate-500">
          <tr>
            {['Invoice', 'Date', 'Supplier', 'For', 'Purchase order', 'Lot', 'Total (₹)', 'Payment', ''].map((h) => (
              <th key={h} className="px-3 py-1.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="font-mono font-medium text-slate-900">{r.invoiceNo}</span>
                {r.fileId && (
                  <a href={`/api/files/${r.fileId}`} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex align-middle text-brand-700" title="Open the bill">
                    <Paperclip className="size-3.5" />
                  </a>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{r.invoiceDate}</td>
              <td className="px-3 py-2">{r.supplierName}</td>
              <td className="px-3 py-2 text-slate-600">
                {PURCHASE_CATEGORIES[r.category]}
                {r.description && <div className="max-w-56 truncate text-[11.5px] text-slate-400">{r.description}</div>}
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-slate-600">{r.vendorPoNumber ?? '—'}</td>
              <td className="px-3 py-2 text-slate-600">{r.lotNo ? `Lot ${r.lotNo}` : '—'}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatAmount(r.totalAmount, 2)}</td>
              <td className="px-3 py-2">
                <Chip tone={PAY_CHIP[r.paymentStatus]}>{PAY_LABEL[r.paymentStatus]}</Chip>
                {r.dueDate && r.paymentStatus !== 'PAID' && <div className="text-[11.5px] text-slate-500">due {r.dueDate}</div>}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {onEdit && <Button variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(r)} aria-label={`Edit ${r.invoiceNo}`} />}
                {onDelete && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(r)} aria-label={`Delete ${r.invoiceNo}`} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PurchaseInvoicesPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [edit, setEdit] = useState<PurchaseInvoiceRow | 'new' | null>(null);
  const [del, setDel] = useState<PurchaseInvoiceRow | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['purchase-invoices', status, category, debounced], queryFn: () => api.get<PurchaseInvoiceRow[]>(`/purchase-invoices${qs({ status, category, search: debounced })}`), placeholderData: keepPreviousData });
  const rows = q.data ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
    qc.invalidateQueries({ queryKey: ['vendor-pos'] });
    qc.invalidateQueries({ queryKey: ['order-file'] });
  };
  useHotkeys({ '/': () => searchRef.current?.focus(), 'alt+n': () => can('sales.purchaseInvoices', 'create') && setEdit('new'), 'alt+u': () => navigate('/inbox') }, []);
  const due = money(rows, 'totalAmount') - money(rows, 'paidAmount');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Purchase invoices"
        subtitle="Bills from suppliers (packaging, paddy / rice, services), grouped by the order they are for."
        actions={
          <>
            {can('sales.intake', 'create') && (
              <Button icon={<FileUp className="size-3.5" />} onClick={() => navigate('/inbox')} shortcut="alt+u">
                Read from a scanned bill
              </Button>
            )}
            {can('sales.purchaseInvoices', 'create') && (
              <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')} shortcut="alt+n">
                New purchase invoice
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} className="field-input pl-7" placeholder="Bill no., supplier, order, PO…  ( / )" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => ['ArrowDown', 'Escape', 'Enter'].includes(e.key) && (e.preventDefault(), e.currentTarget.blur())} aria-label="Search purchase invoices" />
        </div>
        <select className="field-input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {PURCHASE_CATEGORY_KEYS.map((k) => (
            <option key={k} value={k}>
              {PURCHASE_CATEGORIES[k]}
            </option>
          ))}
        </select>
        <select className="field-input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Payment">
          <option value="">Paid and unpaid</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PART">Part paid</option>
          <option value="PAID">Paid</option>
        </select>
        {rows.length > 0 && (
          <span className="ml-auto text-[12.5px] text-slate-600">
            {rows.length} bill(s) · ₹{formatAmount(String(money(rows, 'totalAmount')), 2)} · <b className={due > 0.005 ? 'text-amber-700' : 'text-emerald-700'}>₹{formatAmount(String(due), 2)} to pay</b>
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !rows.length ? (
          <Card className="p-8 text-center text-[13px] text-slate-500">No purchase invoices here. Press “New purchase invoice”, or upload the bill in the Document inbox and confirm it.</Card>
        ) : (
          <OrderGroups
            groups={groupByOrder(rows, (r) => ({ orderId: r.orderId, orderNumber: r.orderNumber, buyer: r.buyer, orderSource: r.orderSource }))}
            noOrderLabel="Bills not linked to a sales order"
            summary={(g) => {
              const owed = money(g.items, 'totalAmount') - money(g.items, 'paidAmount');
              return (
                <>
                  <Chip>
                    {g.items.length} bill(s) · ₹{formatAmount(String(money(g.items, 'totalAmount')), 0)}
                  </Chip>
                  <Chip tone={owed > 0.005 ? 'amber' : 'green'}>{owed > 0.005 ? `₹${formatAmount(String(owed), 0)} to pay` : 'all paid'}</Chip>
                </>
              );
            }}
          >
            {(g) => <BillTable rows={g.items} onEdit={can('sales.purchaseInvoices', 'edit') ? setEdit : undefined} onDelete={can('sales.purchaseInvoices', 'delete') ? setDel : undefined} />}
          </OrderGroups>
        )}
      </div>
      {edit && <PurchaseInvoiceModal row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={refresh} />}
      <ConfirmDialog
        open={!!del}
        title={`Delete bill ${del?.invoiceNo ?? ''}?`}
        message="It moves to the recycle bin and can be restored."
        confirmLabel="Delete"
        danger
        requireReason
        onClose={() => setDel(null)}
        onConfirm={async (reason) => {
          await api.del(`/purchase-invoices/${del!.id}`, { reason });
          toast.success('Moved to the recycle bin');
          refresh();
        }}
      />
    </div>
  );
}
