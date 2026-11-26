/**
 * Entry forms of the buying side: a purchase order to a supplier, and a purchase invoice (the
 * supplier's bill). Both can be linked to a sales order (and a lot) so the order file shows them.
 */
import { businessDate, PURCHASE_CATEGORIES, PURCHASE_CATEGORY_KEYS, type PurchaseCategory } from '@rmm/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, qs } from '../lib/api';
import { useHotkeys } from '../lib/hotkeys';
import { useSession } from '../lib/session';
import { enterNavigation } from './EntityForm';
import { Modal } from './Modal';
import { RefSelect } from './RefSelect';
import { Button, ErrorBox } from './ui';

interface Ref {
  id: string;
  label: string;
}

export interface PurchaseInvoiceRow {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  supplierId: string;
  supplierName: string | null;
  vendorPoId: string | null;
  vendorPoNumber: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderSource: string | null;
  buyer: string | null;
  shipmentId: string | null;
  lotNo: number | null;
  category: PurchaseCategory;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  taxableAmount: string | null;
  gstAmount: string | null;
  totalAmount: string;
  paidAmount: string;
  dueDate: string | null;
  fileId: string | null;
  inboxItemId: string | null;
  notes: string | null;
  version: number;
  paymentStatus: 'UNPAID' | 'PART' | 'PAID';
}

const errField = (error: unknown, k: string) => (error && typeof error === 'object' && 'fields' in error ? (error as { fields: Record<string, string> }).fields[k] : undefined);

function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`grid content-start gap-1 ${wide ? 'col-span-full' : ''}`}>
      <span className="text-[12px] font-medium text-slate-600">{label}</span>
      {children}
      {error && <span className="text-[11.5px] text-red-600">{error}</span>}
    </div>
  );
}

function CategorySelect({ value, onChange }: { value: PurchaseCategory; onChange: (c: PurchaseCategory) => void }) {
  return (
    <select data-nav="1" className="field-input" value={value} onChange={(e) => onChange(e.target.value as PurchaseCategory)}>
      {PURCHASE_CATEGORY_KEYS.map((k) => (
        <option key={k} value={k}>
          {PURCHASE_CATEGORIES[k]}
        </option>
      ))}
    </select>
  );
}

export function PurchaseInvoiceModal({ row, order: fixedOrder, onClose, onSaved }: { row?: PurchaseInvoiceRow; order?: Ref; onClose: () => void; onSaved: () => void }) {
  const { can } = useSession();
  const [supplier, setSupplier] = useState<Ref | null>(row ? { id: row.supplierId, label: row.supplierName ?? '' } : null);
  const [order, setOrder] = useState<Ref | null>(row?.orderId ? { id: row.orderId, label: row.orderNumber ?? '' } : (fixedOrder ?? null));
  const [f, setF] = useState({
    invoiceNo: row?.invoiceNo ?? '',
    invoiceDate: row?.invoiceDate ?? businessDate(),
    category: (row?.category ?? 'PACKAGING') as PurchaseCategory,
    vendorPoId: row?.vendorPoId ?? '',
    shipmentId: row?.shipmentId ?? '',
    description: row?.description ?? '',
    quantity: row?.quantity ? String(Number(row.quantity)) : '',
    unit: row?.unit ?? '',
    taxableAmount: row?.taxableAmount ?? '',
    gstAmount: row?.gstAmount ?? '',
    totalAmount: row?.totalAmount ?? '',
    paidAmount: row && Number(row.paidAmount) ? row.paidAmount : '',
    dueDate: row?.dueDate ?? '',
    notes: row?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pos = useQuery({
    queryKey: ['vendor-pos', 'for-bill', supplier?.label ?? ''],
    queryFn: () => api.get<{ id: string; number: string; supplierName: string | null; totalAmount: string; orderId: string | null; orderNumber: string | null }[]>(`/vendor-pos${qs({ search: supplier?.label })}`),
    enabled: !!supplier && can('sales.vendorPos', 'view'),
  });
  const lots = useQuery({ queryKey: ['order-file', order?.id], queryFn: () => api.get<{ lots: { id: string; lotNo: number }[] }>(`/order-files/${order!.id}`), enabled: !!order });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...f,
        supplierId: supplier?.id ?? '',
        proformaInvoiceId: order?.id ?? null,
        vendorPoId: f.vendorPoId || null,
        shipmentId: f.shipmentId || null,
        dueDate: f.dueDate || null,
        ...(row ? { version: row.version } : {}),
      };
      if (row) await api.put(`/purchase-invoices/${row.id}`, body);
      else await api.post('/purchase-invoices', body);
      toast.success(row ? 'Purchase invoice saved' : 'Purchase invoice entered');
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  useHotkeys({ 'mod+s, mod+enter': () => save() }, [f, supplier, order, busy], { inModal: true, inInputs: true });
  const text = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label} error={errField(error, k)}>
      <input data-nav="1" className="field-input" value={f[k]} onChange={(e) => set(k, e.target.value as never)} {...extra} />
    </Field>
  );

  return (
    <Modal
      open
      width="max-w-3xl"
      title={row ? `Purchase invoice ${row.invoiceNo}` : 'New purchase invoice (supplier bill)'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} shortcut="esc">
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} shortcut="mod+s" data-nav-end>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3" onKeyDown={enterNavigation}>
        <Field label="Supplier" error={errField(error, 'supplierId')}>
          <RefSelect
            entity="suppliers"
            value={supplier?.id ?? null}
            label={supplier?.label ?? null}
            allowCreate
            onChange={(id, label) => {
              setSupplier(id ? { id, label: label ?? '' } : null);
              set('vendorPoId', '');
            }}
          />
        </Field>
        {text('invoiceNo', "Supplier's invoice no.")}
        {text('invoiceDate', 'Invoice date', { type: 'date' })}
        <Field label="For">
          <CategorySelect value={f.category} onChange={(c) => set('category', c)} />
        </Field>
        <Field label="Against purchase order" error={errField(error, 'vendorPoId')}>
          <select
            data-nav="1"
            className="field-input"
            value={f.vendorPoId}
            disabled={!supplier}
            onChange={(e) => {
              set('vendorPoId', e.target.value);
              const po = pos.data?.find((p) => p.id === e.target.value);
              if (po?.orderId && !order) setOrder({ id: po.orderId, label: po.orderNumber ?? '' });
            }}
          >
            <option value="">— none —</option>
            {(pos.data ?? [])
              .filter((p) => p.supplierName === supplier?.label)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} · ₹{Number(p.totalAmount).toLocaleString('en-IN')}
                </option>
              ))}
          </select>
        </Field>
        <Field label="For sales order (optional)" error={errField(error, 'proformaInvoiceId')}>
          <RefSelect
            entity="proformaInvoices"
            source="document"
            value={order?.id ?? null}
            label={order?.label ?? null}
            placeholder="Search order / PI no.…"
            onChange={(id, label) => {
              setOrder(id ? { id, label: label ?? '' } : null);
              set('shipmentId', '');
            }}
          />
        </Field>
        <Field label="For lot (optional)" error={errField(error, 'shipmentId')}>
          <select data-nav="1" className="field-input" value={f.shipmentId} disabled={!order} onChange={(e) => set('shipmentId', e.target.value)}>
            <option value="">— whole order —</option>
            {(lots.data?.lots ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                Lot {l.lotNo}
              </option>
            ))}
          </select>
        </Field>
        {text('description', 'Goods / service')}
        <div className="grid grid-cols-[2fr_1fr] gap-2">
          {text('quantity', 'Quantity', { inputMode: 'decimal' })}
          {text('unit', 'Unit', { placeholder: 'Nos, MT' })}
        </div>
        {text('taxableAmount', 'Taxable amount (₹)', { inputMode: 'decimal' })}
        {text('gstAmount', 'GST (₹)', { inputMode: 'decimal' })}
        {text('totalAmount', 'Invoice total (₹)', { inputMode: 'decimal' })}
        {text('paidAmount', 'Paid so far (₹)', { inputMode: 'decimal' })}
        {text('dueDate', 'Due date', { type: 'date' })}
        <Field label="Notes" wide>
          <textarea data-nav="1" className="field-input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="col-span-full">
          <ErrorBox error={error} />
        </div>
      </div>
    </Modal>
  );
}

export function PurchaseOrderModal({ order: fixedOrder, onClose, onSaved }: { order?: Ref; onClose: () => void; onSaved: () => void }) {
  const [supplier, setSupplier] = useState<Ref | null>(null);
  const [order, setOrder] = useState<Ref | null>(fixedOrder ?? null);
  const [f, setF] = useState({ number: '', poDate: businessDate(), category: 'PACKAGING' as PurchaseCategory, deliveryBy: '', notes: '' });
  const [lines, setLines] = useState([{ key: 1, description: '', quantity: '', unit: 'Nos', rate: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { key: Date.now(), description: '', quantity: '', unit: ls[ls.length - 1]?.unit ?? 'Nos', rate: '' }]);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/vendor-pos', {
        ...f,
        number: f.number || null,
        deliveryBy: f.deliveryBy || null,
        supplierId: supplier?.id ?? '',
        proformaInvoiceId: order?.id ?? null,
        lines: lines.filter((l) => l.description || l.quantity).map(({ key: _k, ...l }) => l),
      });
      toast.success('Purchase order saved');
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  useHotkeys({ 'mod+s, mod+enter': () => save(), 'alt+a': () => addLine() }, [f, supplier, order, lines, busy], { inModal: true, inInputs: true });

  return (
    <Modal
      open
      width="max-w-3xl"
      title="New purchase order (to a supplier)"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-[13px] text-slate-600">Total ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          <Button onClick={onClose} shortcut="esc">
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} shortcut="mod+s" data-nav-end>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3" onKeyDown={enterNavigation}>
        <Field label="Supplier" error={errField(error, 'supplierId')}>
          <RefSelect entity="suppliers" value={supplier?.id ?? null} label={supplier?.label ?? null} allowCreate onChange={(id, label) => setSupplier(id ? { id, label: label ?? '' } : null)} />
        </Field>
        <Field label="PO date">
          <input data-nav="1" type="date" className="field-input" value={f.poDate} onChange={(e) => setF({ ...f, poDate: e.target.value })} />
        </Field>
        <Field label="PO no. (empty = next number)">
          <input data-nav="1" className="field-input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
        </Field>
        <Field label="For">
          <CategorySelect value={f.category} onChange={(c) => setF({ ...f, category: c })} />
        </Field>
        <Field label="For sales order (optional)">
          <RefSelect entity="proformaInvoices" source="document" value={order?.id ?? null} label={order?.label ?? null} placeholder="Search order / PI no.…" onChange={(id, label) => setOrder(id ? { id, label: label ?? '' } : null)} />
        </Field>
        <Field label="Delivery by">
          <input data-nav="1" type="date" className="field-input" value={f.deliveryBy} onChange={(e) => setF({ ...f, deliveryBy: e.target.value })} />
        </Field>
        <div className="col-span-full space-y-1.5">
          <div className="grid grid-cols-[1fr_100px_80px_100px_32px] gap-2 text-[12px] font-medium text-slate-600">
            <span>Item</span>
            <span>Quantity</span>
            <span>Unit</span>
            <span>Rate (₹)</span>
          </div>
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-[1fr_100px_80px_100px_32px] gap-2">
              <input data-nav="1" className="field-input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={`Item ${i + 1}`} />
              <input data-nav="1" className="field-input" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantity" />
              <input data-nav="1" className="field-input" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label="Unit" />
              <input data-nav="1" className="field-input" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} aria-label="Rate" />
              <button type="button" tabIndex={-1} aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="rounded text-slate-400 hover:text-red-600 disabled:opacity-30">
                <Trash2 className="mx-auto size-3.5" />
              </button>
            </div>
          ))}
          <Button icon={<Plus className="size-3.5" />} onClick={addLine} shortcut="alt+a">
            Add item
          </Button>
        </div>
        <Field label="Notes" wide>
          <textarea data-nav="1" className="field-input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <div className="col-span-full">
          <ErrorBox error={error} />
        </div>
      </div>
    </Modal>
  );
}
