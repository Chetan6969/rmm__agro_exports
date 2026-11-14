'use client';

import React, { useMemo, useState } from 'react';
import { X, Plus, Pencil, Trash2, Save, Loader2, Boxes } from 'lucide-react';
import {
  api,
  type BankDetail,
  type Customer,
  type PackingType,
  type Port,
  type Product,
  type ProductionOrderListItem,
  type Term,
  type CreateCommercialInvoiceInput,
} from '../../lib/api';
import { InvoiceAddLineDialog } from './InvoiceAddLineDialog';
import { InvoiceContainersDialog } from './InvoiceContainersDialog';
import type { InvContainerDraft, InvLineDraft } from './types';

export interface InvMasterData {
  customers: Customer[];
  products: Product[];
  packingTypes: PackingType[];
  ports: Port[];
  banks: BankDetail[];
  terms: Term[];
  shippingLines: { id: string; name: string }[];
  productionOrders: ProductionOrderListItem[];
}

interface Props {
  master: InvMasterData;
  onSaved: (documentNumber: string) => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
type Tab = 'invoice' | 'parties' | 'shipping' | 'charges' | 'goods' | 'terms';

export function InvoiceFormDialog({ master, onSaved, onClose }: Props) {
  const loadingPorts = master.ports.filter((p) => p.portType === 'LOADING' || p.portType === 'BOTH');
  const dischargePorts = master.ports.filter((p) => p.portType === 'DISCHARGE' || p.portType === 'BOTH');

  const [tab, setTab] = useState<Tab>('invoice');

  // Invoice tab
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentDate, setDocumentDate] = useState(today());
  const [invoiceType, setInvoiceType] = useState('WHITE');
  const [status, setStatus] = useState('DRAFT');
  const [productionOrderId, setProductionOrderId] = useState('');
  const [buyerPoNumber, setBuyerPoNumber] = useState('');
  const [lcNumber, setLcNumber] = useState('');
  const [lcDateOn, setLcDateOn] = useState(false);
  const [lcDate, setLcDate] = useState(today());
  const [exchangeRate, setExchangeRate] = useState('');
  const [freight, setFreight] = useState('0');
  const [insurance, setInsurance] = useState('0');
  const [grossWt, setGrossWt] = useState('');
  const [fcl, setFcl] = useState('');
  const [bankDetailsId, setBankDetailsId] = useState(
    master.banks.find((b) => b.isDefault)?.id || master.banks[0]?.id || '',
  );

  // Parties
  const [customerId, setCustomerId] = useState(master.customers[0]?.id || '');
  const [consigneeId, setConsigneeId] = useState(master.customers[0]?.id || '');
  const [notifyPartyId, setNotifyPartyId] = useState('');

  // Shipping
  const [preCarriageBy, setPreCarriageBy] = useState('');
  const [placeOfReceipt, setPlaceOfReceipt] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('India');
  const [countryOfDestination, setCountryOfDestination] = useState('');
  const [vesselFlightName, setVesselFlightName] = useState('');
  const [portOfLoading, setPortOfLoading] = useState(loadingPorts[0]?.name || '');
  const [portOfDischarge, setPortOfDischarge] = useState(dischargePorts[0]?.name || '');
  const [finalDestination, setFinalDestination] = useState('');
  const [termsOf, setTermsOf] = useState('');
  const [paymentTerm, setPaymentTerm] = useState('');
  const [containerNo, setContainerNo] = useState('');
  const [sealNo, setSealNo] = useState('');
  const [ladingBlNumber, setLadingBlNumber] = useState('');
  const [ladingBlDateOn, setLadingBlDateOn] = useState(false);
  const [ladingBlDate, setLadingBlDate] = useState(today());
  const [shippingBillNumber, setShippingBillNumber] = useState('');
  const [shippingBillDateOn, setShippingBillDateOn] = useState(false);
  const [shippingBillDate, setShippingBillDate] = useState(today());

  // Shipping & charges
  const [shippingLineId, setShippingLineId] = useState('');
  const [incoterm, setIncoterm] = useState<'FOB' | 'CFR' | 'CIF'>('FOB');
  const [thc, setThc] = useState('');
  const [bl, setBl] = useState('');
  const [seal, setSeal] = useState('');
  const [muc, setMuc] = useState('');
  const [risk, setRisk] = useState('');
  const [reposition, setReposition] = useState('');

  // Goods
  const [brand, setBrand] = useState('');
  const [marksNumbers, setMarksNumbers] = useState('');
  const [goodsDescription, setGoodsDescription] = useState('');
  const [lines, setLines] = useState<InvLineDraft[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);
  const [editingLine, setEditingLine] = useState<InvLineDraft | null>(null);
  const [containers, setContainers] = useState<InvContainerDraft[]>([]);
  const [showContainers, setShowContainers] = useState(false);

  // Terms
  const [showSignature, setShowSignature] = useState(true);
  const [selectedTermIds, setSelectedTermIds] = useState<Set<string>>(
    () => new Set(master.terms.filter((t) => t.isDefault).map((t) => t.id)),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => parseFloat(v) || 0;
  const totalCharges = useMemo(
    () => num(thc) + num(bl) + num(seal) + num(muc) + num(risk) + num(reposition) + num(freight) + num(insurance),
    [thc, bl, seal, muc, risk, reposition, freight, insurance],
  );
  const totals = useMemo(() => {
    const netWt = lines.reduce((s, l) => s + l.quantityMt, 0);
    const bags = lines.reduce((s, l) => s + l.noOfBags, 0);
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    const gst = lines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0);
    return { netWt, bags, amount, gst };
  }, [lines]);

  const onSelectPo = async (poId: string) => {
    setProductionOrderId(poId);
    if (!poId) return;
    try {
      const d = await api.getProductionOrder(poId);
      const o = d.order;
      if (o.customerId) setCustomerId(o.customerId);
      if (o.consigneeId) setConsigneeId(o.consigneeId);
      if (o.notifyPartyId) setNotifyPartyId(o.notifyPartyId);
      setIncoterm((o.incoterm as 'FOB' | 'CFR' | 'CIF') || 'FOB');
      if (o.brand) setBrand(o.brand);
      if (o.portOfLoading) setPortOfLoading(o.portOfLoading);
      if (o.portOfDischarge) setPortOfDischarge(o.portOfDischarge);
      if (o.destinationCountry) setCountryOfDestination(o.destinationCountry);
      if (o.paymentTerm) setPaymentTerm(o.paymentTerm);
      if (o.buyerPoRef) setBuyerPoNumber(o.buyerPoRef);
    } catch {
      /* ignore prefill errors */
    }
  };

  const upsertLine = (line: InvLineDraft, addAnother: boolean) => {
    setLines((prev) => {
      const exists = prev.some((l) => l.id === line.id);
      return exists ? prev.map((l) => (l.id === line.id ? line : l)) : [...prev, line];
    });
    setEditingLine(null);
    if (!addAnother) setShowAddLine(false);
  };
  const editSelected = () => {
    const l = lines.find((x) => x.id === selectedLineId);
    if (l) { setEditingLine(l); setShowAddLine(true); }
  };
  const toggleTerm = (id: string) =>
    setSelectedTermIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    setError(null);
    if (!documentNumber.trim()) { setTab('invoice'); return setError('Enter an Invoice no'); }
    if (lines.length === 0) { setTab('goods'); return setError('Add at least one product line'); }

    const terms = Array.from(selectedTermIds)
      .map((id) => master.terms.find((t) => t.id === id))
      .filter((t): t is Term => Boolean(t))
      .map((t) => ({ termId: t.id, content: t.content }));

    const dto: CreateCommercialInvoiceInput = {
      documentNumber: documentNumber.trim(),
      documentDate,
      status,
      invoiceType,
      productionOrderId: productionOrderId || undefined,
      buyerPoNumber: buyerPoNumber || undefined,
      customerId,
      consigneeId: consigneeId || undefined,
      notifyPartyId: notifyPartyId || undefined,
      lcNumber: lcNumber || undefined,
      lcDate: lcDateOn ? lcDate : undefined,
      exchangeRate: exchangeRate ? num(exchangeRate) : undefined,
      freightAmount: num(freight),
      insuranceAmount: num(insurance),
      grossWtMt: grossWt ? num(grossWt) : undefined,
      fcl: fcl || undefined,
      shippingLineId: shippingLineId || undefined,
      preCarriageBy: preCarriageBy || undefined,
      placeOfReceipt: placeOfReceipt || undefined,
      countryOfOrigin: countryOfOrigin || 'India',
      shippingBillNumber: shippingBillNumber || undefined,
      shippingBillDate: shippingBillDateOn ? shippingBillDate : undefined,
      ladingBlNumber: ladingBlNumber || undefined,
      ladingBlDate: ladingBlDateOn ? ladingBlDate : undefined,
      vesselFlightName: vesselFlightName || undefined,
      containerNo: containerNo || undefined,
      sealNo: sealNo || undefined,
      portOfLoading: portOfLoading || undefined,
      portOfDischarge: portOfDischarge || undefined,
      countryOfDestination: countryOfDestination || finalDestination || undefined,
      termsOf: termsOf || undefined,
      paymentTerm: paymentTerm || undefined,
      brand: brand || undefined,
      marksNumbers: marksNumbers || undefined,
      goodsDescription: goodsDescription || undefined,
      incoterm,
      bankDetailsId: bankDetailsId || undefined,
      showSignature,
      terms,
      items: lines.map((l) => ({
        productId: l.productId,
        packingTypeId: l.packingTypeId || undefined,
        packingText: l.packingText || undefined,
        noOfBags: l.noOfBags,
        quantityMt: l.quantityMt,
        grossWtMt: l.grossWtMt,
        ratePerMt: l.ratePerMt,
        cgst: l.cgst,
        sgst: l.sgst,
        igst: l.igst,
        brokenBelow: l.brokenBelow,
        fcl: l.fcl,
      })),
      shippingCharges: {
        thcCharge: num(thc),
        blCharge: num(bl),
        sealCharge: num(seal),
        mucCharge: num(muc),
        riskCharge: num(risk),
        repositionCharge: num(reposition),
        oceanFreightCharge: num(freight),
        insuranceCharge: num(insurance),
      },
      containers: containers.map((c) => ({
        containerNumber: c.containerNumber,
        sealNumber: c.sealNumber,
        containerSize: c.containerSize,
        totalBags: c.totalBags,
        grossWeightKg: c.grossWeightKg,
        netWeightKg: c.netWeightKg,
      })),
    };

    setSaving(true);
    try {
      const res = await api.createInvoice(dto);
      onSaved(res.documentNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tabs: { id: Tab; label: string }[] = [
    { id: 'invoice', label: 'Invoice' },
    { id: 'parties', label: 'Parties' },
    { id: 'shipping', label: 'Shipping' },
    { id: 'charges', label: 'Shipping & Charges' },
    { id: 'goods', label: 'Goods & items' },
    { id: 'terms', label: 'Terms & Conditions' },
  ];
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><label className="ef-label">{label}</label>{children}</div>
  );

  return (
    <div className="ef-overlay" onMouseDown={onClose}>
      <div className="ef-modal max-w-5xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-bar">
          <span>New Invoice</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex items-center justify-between px-3 pt-2 border-b border-slate-200 bg-slate-50">
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 ${tab === t.id ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-1">
            <button className="ef-btn" onClick={() => setShowContainers(true)}><Boxes className="w-3.5 h-3.5" /> Containers{containers.length ? ` (${containers.length})` : ''}</button>
            <button className="ef-btn ef-btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
            <button className="ef-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {error && <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          {tab === 'invoice' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
              <Field label="Generate against — PO">
                <select className="ef-select" value={productionOrderId} onChange={(e) => onSelectPo(e.target.value)}>
                  <option value="">— none —</option>
                  {master.productionOrders.map((p) => <option key={p.id} value={p.id}>{p.documentNumber} — {p.customerName || ''}</option>)}
                </select>
              </Field>
              <Field label="Dollar rate"><input className="ef-input" type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} /></Field>
              <Field label="Buyer PO"><input className="ef-input" value={buyerPoNumber} onChange={(e) => setBuyerPoNumber(e.target.value)} /></Field>
              <Field label="Freight charges"><input className="ef-input" type="number" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} /></Field>
              <Field label="Invoice no *"><input className="ef-input" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="e.g. RMM/EX/26-27/206" /></Field>
              <Field label="Insurance"><input className="ef-input" type="number" step="0.01" value={insurance} onChange={(e) => setInsurance(e.target.value)} /></Field>
              <Field label="Invoice date"><input className="ef-input" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} /></Field>
              <Field label="Gross wt (MT)"><input className="ef-input" type="number" step="0.001" value={grossWt} onChange={(e) => setGrossWt(e.target.value)} /></Field>
              <Field label="Invoice type">
                <select className="ef-select" value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
                  <option value="WHITE">White</option><option value="CUSTOM">Custom</option>
                </select>
              </Field>
              <Field label="FCL (e.g. 3 X 20')"><input className="ef-input" value={fcl} onChange={(e) => setFcl(e.target.value)} /></Field>
              <Field label="Status">
                <select className="ef-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="DRAFT">Draft</option><option value="FINAL">Final</option><option value="CANCELLED">Cancelled</option>
                </select>
              </Field>
              <Field label="Our Bank">
                <select className="ef-select" value={bankDetailsId} onChange={(e) => setBankDetailsId(e.target.value)}>
                  <option value="">— none —</option>
                  {master.banks.map((b) => <option key={b.id} value={b.id}>{b.bankName} — {b.accountNumber}</option>)}
                </select>
              </Field>
              <Field label="LC no"><input className="ef-input" value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} /></Field>
              <div />
              <Field label="LC date">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="ef-check" checked={lcDateOn} onChange={(e) => setLcDateOn(e.target.checked)} />
                  <input className="ef-input" type="date" value={lcDate} disabled={!lcDateOn} onChange={(e) => setLcDate(e.target.value)} />
                </div>
              </Field>
            </div>
          )}

          {tab === 'parties' && (
            <div className="space-y-3 max-w-2xl">
              <Field label="Buyer (Customer) *">
                <select className="ef-select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  {master.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Consignee *">
                <select className="ef-select" value={consigneeId} onChange={(e) => setConsigneeId(e.target.value)}>
                  {master.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Notify party">
                <select className="ef-select" value={notifyPartyId} onChange={(e) => setNotifyPartyId(e.target.value)}>
                  <option value="">— none —</option>
                  {master.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <p className="text-xs text-slate-500">The full name/address/TEL for each party comes from the Customers screen.</p>
            </div>
          )}

          {tab === 'shipping' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
              <Field label="Pre-carriage by"><input className="ef-input" value={preCarriageBy} onChange={(e) => setPreCarriageBy(e.target.value)} /></Field>
              <Field label="Terms of"><input className="ef-input" value={termsOf} onChange={(e) => setTermsOf(e.target.value)} /></Field>
              <Field label="Place of receipt"><input className="ef-input" value={placeOfReceipt} onChange={(e) => setPlaceOfReceipt(e.target.value)} /></Field>
              <Field label="Payment term"><input className="ef-input" value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)} /></Field>
              <Field label="Country of origin"><input className="ef-input" value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} /></Field>
              <Field label="Container no"><input className="ef-input" value={containerNo} onChange={(e) => setContainerNo(e.target.value)} /></Field>
              <Field label="Country final dest."><input className="ef-input" value={countryOfDestination} onChange={(e) => setCountryOfDestination(e.target.value)} /></Field>
              <Field label="Seal no"><input className="ef-input" value={sealNo} onChange={(e) => setSealNo(e.target.value)} /></Field>
              <Field label="Vessel / Flight no"><input className="ef-input" value={vesselFlightName} onChange={(e) => setVesselFlightName(e.target.value)} /></Field>
              <Field label="Lading B/L no"><input className="ef-input" value={ladingBlNumber} onChange={(e) => setLadingBlNumber(e.target.value)} /></Field>
              <Field label="Port of loading">
                <select className="ef-select" value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)}>
                  <option value="">— select —</option>
                  {loadingPorts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Lading B/L date">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="ef-check" checked={ladingBlDateOn} onChange={(e) => setLadingBlDateOn(e.target.checked)} />
                  <input className="ef-input" type="date" value={ladingBlDate} disabled={!ladingBlDateOn} onChange={(e) => setLadingBlDate(e.target.value)} />
                </div>
              </Field>
              <Field label="Port of discharge">
                <select className="ef-select" value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)}>
                  <option value="">— select —</option>
                  {dischargePorts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Shipping bill no"><input className="ef-input" value={shippingBillNumber} onChange={(e) => setShippingBillNumber(e.target.value)} /></Field>
              <Field label="Final destination"><input className="ef-input" value={finalDestination} onChange={(e) => setFinalDestination(e.target.value)} /></Field>
              <Field label="Shipping bill date">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="ef-check" checked={shippingBillDateOn} onChange={(e) => setShippingBillDateOn(e.target.checked)} />
                  <input className="ef-input" type="date" value={shippingBillDate} disabled={!shippingBillDateOn} onChange={(e) => setShippingBillDate(e.target.value)} />
                </div>
              </Field>
            </div>
          )}

          {tab === 'charges' && (
            <div className="max-w-xl space-y-2.5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                <Field label="Shipping line">
                  <select className="ef-select" value={shippingLineId} onChange={(e) => setShippingLineId(e.target.value)}>
                    <option value="">— select —</option>
                    {master.shippingLines.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Incoterm">
                  <select className="ef-select" value={incoterm} onChange={(e) => setIncoterm(e.target.value as 'FOB' | 'CFR' | 'CIF')}>
                    <option value="FOB">FOB</option><option value="CFR">CFR</option><option value="CIF">CIF</option>
                  </select>
                </Field>
              </div>
              <div className="ef-section-title pt-2">Charges (fields depend on incoterm)</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                <Field label="THC"><input className="ef-input" type="number" step="0.01" value={thc} onChange={(e) => setThc(e.target.value)} /></Field>
                <Field label="BL"><input className="ef-input" type="number" step="0.01" value={bl} onChange={(e) => setBl(e.target.value)} /></Field>
                <Field label="Seal"><input className="ef-input" type="number" step="0.01" value={seal} onChange={(e) => setSeal(e.target.value)} /></Field>
                <Field label="MUC"><input className="ef-input" type="number" step="0.01" value={muc} onChange={(e) => setMuc(e.target.value)} /></Field>
                <Field label="Risk charges"><input className="ef-input" type="number" step="0.01" value={risk} onChange={(e) => setRisk(e.target.value)} /></Field>
                <Field label="Reposition charges"><input className="ef-input" type="number" step="0.01" value={reposition} onChange={(e) => setReposition(e.target.value)} /></Field>
              </div>
              <div className="text-sm font-bold text-blue-700 pt-2">Total charges: {fmt(totalCharges)}</div>
            </div>
          )}

          {tab === 'goods' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Brand"><input className="ef-input" value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
                <Field label="Marks numbers"><textarea className="ef-textarea" rows={2} value={marksNumbers} onChange={(e) => setMarksNumbers(e.target.value)} /></Field>
                <Field label="Description / variety"><textarea className="ef-textarea" rows={2} value={goodsDescription} onChange={(e) => setGoodsDescription(e.target.value)} /></Field>
              </div>
              <div className="flex items-center gap-2">
                <button className="ef-btn ef-btn-primary" onClick={() => { setEditingLine(null); setShowAddLine(true); }}><Plus className="w-3.5 h-3.5" /> Add line</button>
                <button className="ef-btn" disabled={!selectedLineId} onClick={editSelected}><Pencil className="w-3.5 h-3.5" /> Edit line</button>
                <button className="ef-btn ef-btn-danger" disabled={!selectedLineId} onClick={() => { if (selectedLineId) { setLines((p) => p.filter((l) => l.id !== selectedLineId)); setSelectedLineId(null); } }}><Trash2 className="w-3.5 h-3.5" /> Remove</button>
              </div>
              <div className="ef-card overflow-hidden">
                <div className="overflow-x-auto max-h-52 overflow-y-auto">
                  <table className="ef-table">
                    <thead><tr><th>Product</th><th>Packing</th><th className="text-right">Bags</th><th className="text-right">Net wt</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {lines.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-4">No lines — click “Add line”.</td></tr>}
                      {lines.map((l) => (
                        <tr key={l.id} className={`cursor-pointer ${selectedLineId === l.id ? 'selected' : ''}`}
                          onClick={() => setSelectedLineId(l.id)} onDoubleClick={() => { setSelectedLineId(l.id); editSelected(); }}>
                          <td className="font-medium text-slate-800">{l.productName}</td>
                          <td className="text-slate-600">{l.packingText || '—'}</td>
                          <td className="text-right font-mono">{l.noOfBags}</td>
                          <td className="text-right font-mono">{l.quantityMt.toFixed(3)}</td>
                          <td className="text-right font-mono">{fmt(l.ratePerMt)}</td>
                          <td className="text-right font-mono font-semibold">{fmt(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'terms' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="ef-check" checked={showSignature} onChange={(e) => setShowSignature(e.target.checked)} />
                Show signature / stamp on this document (and its packing list)
              </label>
              <div className="ef-section-title">Tick the terms conditions to print on this invoice (its packing list uses the same set):</div>
              <div className="ef-card divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {master.terms.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No master terms defined.</div>}
                {master.terms.map((t) => (
                  <label key={t.id} className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" className="ef-check mt-0.5" checked={selectedTermIds.has(t.id)} onChange={() => toggleTerm(t.id)} />
                    <span className="text-xs text-slate-700">{t.content}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 border-t border-slate-200 bg-slate-50 text-xs font-mono text-slate-700">
          <span>Lines: <b>{lines.length}</b></span>
          <span>Net wt: <b>{totals.netWt.toFixed(3)}</b></span>
          <span>Bags: <b>{totals.bags}</b></span>
          <span>Amount: <b>{fmt(totals.amount)}</b></span>
          <span>GST: <b>{fmt(totals.gst)}</b></span>
        </div>
      </div>

      {showAddLine && (
        <InvoiceAddLineDialog
          products={master.products}
          packingTypes={master.packingTypes}
          initial={editingLine}
          onSave={upsertLine}
          onClose={() => { setShowAddLine(false); setEditingLine(null); }}
        />
      )}
      {showContainers && (
        <InvoiceContainersDialog
          containers={containers}
          onChange={setContainers}
          onClose={() => setShowContainers(false)}
        />
      )}
    </div>
  );
}
