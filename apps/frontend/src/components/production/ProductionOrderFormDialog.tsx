'use client';

import React, { useMemo, useState } from 'react';
import { X, Plus, Pencil, Trash2, Save, Loader2 } from 'lucide-react';
import {
  api,
  type Customer,
  type PackingType,
  type Port,
  type Product,
  type ProformaListItem,
  type Term,
  type CreateProductionOrderInput,
} from '../../lib/api';
import { ProductionAddLineDialog } from './ProductionAddLineDialog';
import type { ProdLineDraft } from './types';

export interface ProdMasterData {
  customers: Customer[];
  products: Product[];
  packingTypes: PackingType[];
  ports: Port[];
  terms: Term[];
  proformas: ProformaListItem[];
  countries: { name: string }[];
}

interface Props {
  master: ProdMasterData;
  onSaved: (documentNumber: string) => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
type Tab = 'order' | 'parties' | 'shipping' | 'goods' | 'terms';

export function ProductionOrderFormDialog({ master, onSaved, onClose }: Props) {
  const loadingPorts = master.ports.filter((p) => p.portType === 'LOADING' || p.portType === 'BOTH');
  const dischargePorts = master.ports.filter((p) => p.portType === 'DISCHARGE' || p.portType === 'BOTH');

  const [tab, setTab] = useState<Tab>('order');

  // Order
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentDate, setDocumentDate] = useState(today());
  const [status, setStatus] = useState('OPEN');
  const [incoterm, setIncoterm] = useState('FOB');
  const [lcNumber, setLcNumber] = useState('');
  const [lcDateOn, setLcDateOn] = useState(false);
  const [lcDate, setLcDate] = useState(today());
  const [buyerPoRef, setBuyerPoRef] = useState('');
  const [poDateOn, setPoDateOn] = useState(false);
  const [poDate, setPoDate] = useState(today());
  const [proformaInvoiceId, setProformaInvoiceId] = useState('');
  const [buyerPoNumber, setBuyerPoNumber] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [exchangeRate, setExchangeRate] = useState('');
  const [freight, setFreight] = useState('0');
  const [insurance, setInsurance] = useState('0');
  const [fcl, setFcl] = useState('');

  // Parties
  const [customerId, setCustomerId] = useState(master.customers[0]?.id || '');
  const [consigneeId, setConsigneeId] = useState(master.customers[0]?.id || '');
  const [notifyPartyId, setNotifyPartyId] = useState('');

  // Shipping
  const [preCarriageBy, setPreCarriageBy] = useState('');
  const [placeOfReceipt, setPlaceOfReceipt] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('India');
  const [countryFinalDestination, setCountryFinalDestination] = useState('');
  const [vesselFlightNo, setVesselFlightNo] = useState('');
  const [portOfLoading, setPortOfLoading] = useState(loadingPorts[0]?.name || '');
  const [portOfDischarge, setPortOfDischarge] = useState(dischargePorts[0]?.name || '');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [termsOf, setTermsOf] = useState('');
  const [paymentTerm, setPaymentTerm] = useState('');
  const [brand, setBrand] = useState('');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [orderRemark, setOrderRemark] = useState('');

  // Spec (from PI prefill, editable on goods tab header)
  const [specVariety, setSpecVariety] = useState('');
  const [specAvgLength, setSpecAvgLength] = useState('');
  const [specMoisture, setSpecMoisture] = useState('');
  const [specBroken, setSpecBroken] = useState('');
  const [specCrop, setSpecCrop] = useState('');
  const [millingInstructions, setMillingInstructions] = useState('');

  // Lines & terms
  const [lines, setLines] = useState<ProdLineDraft[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);
  const [editingLine, setEditingLine] = useState<ProdLineDraft | null>(null);
  const [showSignature, setShowSignature] = useState(true);
  const [selectedTermIds, setSelectedTermIds] = useState<Set<string>>(
    () => new Set(master.terms.filter((t) => t.isDefault).map((t) => t.id)),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const netWt = lines.reduce((s, l) => s + l.quantityMt, 0);
    const bags = lines.reduce((s, l) => s + l.noOfBags, 0);
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    const gst = lines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0);
    return { netWt, bags, amount, gst };
  }, [lines]);

  const onSelectPi = async (piId: string) => {
    setProformaInvoiceId(piId);
    if (!piId) return;
    try {
      const d = await api.getProforma(piId);
      const p = d.proforma;
      setCustomerId(p.customerId || customerId);
      setConsigneeId(p.consigneeId || p.customerId || consigneeId);
      if (p.notifyPartyId) setNotifyPartyId(p.notifyPartyId);
      setIncoterm(p.incoterm);
      setCurrency(p.currency);
      setPaymentTerm(p.paymentTerms);
      if (p.brand) setBrand(p.brand);
      if (p.portOfLoading) setPortOfLoading(p.portOfLoading);
      if (p.portOfDischarge) setPortOfDischarge(p.portOfDischarge);
      if (p.finalDestination) setDestinationCountry(p.finalDestination);
      if (p.specVariety) setSpecVariety(p.specVariety);
      if (p.specAvgLengthMm) setSpecAvgLength(p.specAvgLengthMm);
      if (p.specMoisturePct) setSpecMoisture(p.specMoisturePct);
      if (p.specBrokenPct) setSpecBroken(p.specBrokenPct);
      if (p.specCropYear) setSpecCrop(p.specCropYear);
      if (!buyerPoRef && d.proforma.documentNumber) setBuyerPoRef(d.proforma.documentNumber);
    } catch {
      /* ignore prefill errors */
    }
  };

  const upsertLine = (line: ProdLineDraft, addAnother: boolean) => {
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
  const removeSelected = () => {
    if (selectedLineId) { setLines((p) => p.filter((l) => l.id !== selectedLineId)); setSelectedLineId(null); }
  };
  const toggleTerm = (id: string) =>
    setSelectedTermIds((prev) => {
      const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
    });

  const save = async () => {
    setError(null);
    if (!documentNumber.trim()) { setTab('order'); return setError('Enter an Order no'); }
    if (lines.length === 0) { setTab('goods'); return setError('Add at least one product line'); }

    const terms = Array.from(selectedTermIds)
      .map((id) => master.terms.find((t) => t.id === id))
      .filter((t): t is Term => Boolean(t))
      .map((t) => ({ termId: t.id, content: t.content }));

    const dto: CreateProductionOrderInput = {
      documentNumber: documentNumber.trim(),
      documentDate,
      status,
      proformaInvoiceId: proformaInvoiceId || undefined,
      buyerPoNumber: buyerPoNumber || undefined,
      buyerPoRef: buyerPoRef || undefined,
      poDate: poDateOn ? poDate : undefined,
      customerId: customerId || undefined,
      consigneeId: consigneeId || undefined,
      notifyPartyId: notifyPartyId || undefined,
      incoterm,
      currency,
      exchangeRate: exchangeRate ? parseFloat(exchangeRate) : undefined,
      lcNumber: lcNumber || undefined,
      lcDate: lcDateOn ? lcDate : undefined,
      freightAmount: parseFloat(freight) || 0,
      insuranceAmount: parseFloat(insurance) || 0,
      fcl: fcl || undefined,
      preCarriageBy: preCarriageBy || undefined,
      placeOfReceipt: placeOfReceipt || undefined,
      countryOfOrigin: countryOfOrigin || 'India',
      countryFinalDestination: countryFinalDestination || undefined,
      vesselFlightNo: vesselFlightNo || undefined,
      portOfLoading: portOfLoading || undefined,
      portOfDischarge: portOfDischarge || undefined,
      destinationCountry: destinationCountry || undefined,
      termsOf: termsOf || undefined,
      paymentTerm: paymentTerm || undefined,
      brand: brand || undefined,
      transport: transport || undefined,
      vehicleNo: vehicleNo || undefined,
      orderRemark: orderRemark || undefined,
      specVariety: specVariety || undefined,
      specAvgLengthMm: specAvgLength ? parseFloat(specAvgLength) : undefined,
      specMoisturePct: specMoisture ? parseFloat(specMoisture) : undefined,
      specBrokenPct: specBroken ? parseFloat(specBroken) : undefined,
      specCropYear: specCrop || undefined,
      millingInstructions: millingInstructions || undefined,
      showSignature,
      terms,
      items: lines.map((l) => ({
        productId: l.productId,
        packingTypeId: l.packingTypeId || undefined,
        packingText: l.packingText || undefined,
        hsCode: l.hsCode || undefined,
        cropYear: l.cropYear || undefined,
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
    };

    setSaving(true);
    try {
      const res = await api.createProductionOrder(dto);
      onSaved(res.documentNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tabs: { id: Tab; label: string }[] = [
    { id: 'order', label: 'Order' },
    { id: 'parties', label: 'Parties' },
    { id: 'shipping', label: 'Shipping' },
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
          <span>New Production Order</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs + save */}
        <div className="flex items-center justify-between px-3 pt-2 border-b border-slate-200 bg-slate-50">
          <div className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 ${
                  tab === t.id ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-1">
            <button className="ef-btn ef-btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
            <button className="ef-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {error && <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          {tab === 'order' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
              <Field label="Order no *"><input className="ef-input" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="e.g. RMM/4" /></Field>
              <Field label="Generate against — PI">
                <select className="ef-select" value={proformaInvoiceId} onChange={(e) => onSelectPi(e.target.value)}>
                  <option value="">— none —</option>
                  {master.proformas.map((p) => (
                    <option key={p.id} value={p.id}>{p.documentNumber} — {p.consigneeName || ''}</option>
                  ))}
                </select>
              </Field>
              <Field label="Order date"><input className="ef-input" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} /></Field>
              <Field label="Buyer PO"><input className="ef-input" value={buyerPoNumber} onChange={(e) => setBuyerPoNumber(e.target.value)} /></Field>
              <Field label="Status">
                <select className="ef-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="OPEN">Open</option>
                  <option value="IN_PRODUCTION">In production</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </Field>
              <Field label="Dollar rate"><input className="ef-input" type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} /></Field>
              <Field label="Incoterm">
                <select className="ef-select" value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
                  <option value="FOB">FOB</option><option value="CFR">CFR</option><option value="CIF">CIF</option>
                </select>
              </Field>
              <Field label="Freight charges"><input className="ef-input" type="number" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} /></Field>
              <Field label="LC no"><input className="ef-input" value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} /></Field>
              <Field label="Insurance"><input className="ef-input" type="number" step="0.01" value={insurance} onChange={(e) => setInsurance(e.target.value)} /></Field>
              <Field label="LC date">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="ef-check" checked={lcDateOn} onChange={(e) => setLcDateOn(e.target.checked)} />
                  <input className="ef-input" type="date" value={lcDate} disabled={!lcDateOn} onChange={(e) => setLcDate(e.target.value)} />
                </div>
              </Field>
              <Field label="FCL (e.g. 3 X 20')"><input className="ef-input" value={fcl} onChange={(e) => setFcl(e.target.value)} /></Field>
              <Field label="Buyer PO ref"><input className="ef-input" value={buyerPoRef} onChange={(e) => setBuyerPoRef(e.target.value)} /></Field>
              <Field label="PO date">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="ef-check" checked={poDateOn} onChange={(e) => setPoDateOn(e.target.checked)} />
                  <input className="ef-input" type="date" value={poDate} disabled={!poDateOn} onChange={(e) => setPoDate(e.target.value)} />
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
              <Field label="Brand"><input className="ef-input" value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
              <Field label="Country final dest."><input className="ef-input" value={countryFinalDestination} onChange={(e) => setCountryFinalDestination(e.target.value)} /></Field>
              <Field label="Transport"><input className="ef-input" value={transport} onChange={(e) => setTransport(e.target.value)} /></Field>
              <Field label="Vessel / Flight no"><input className="ef-input" value={vesselFlightNo} onChange={(e) => setVesselFlightNo(e.target.value)} /></Field>
              <Field label="Vehicle no"><input className="ef-input" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} /></Field>
              <Field label="Port of loading">
                <select className="ef-select" value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)}>
                  <option value="">— select —</option>
                  {loadingPorts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Order remark">
                <textarea className="ef-textarea" rows={2} value={orderRemark} onChange={(e) => setOrderRemark(e.target.value)} />
              </Field>
              <Field label="Port of discharge">
                <select className="ef-select" value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)}>
                  <option value="">— select —</option>
                  {dischargePorts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Destination country">
                <input className="ef-input" list="ef-countries-po" value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value)} />
                <datalist id="ef-countries-po">{master.countries.map((c) => <option key={c.name} value={c.name} />)}</datalist>
              </Field>
            </div>
          )}

          {tab === 'goods' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Field label="Variety & grade"><input className="ef-input" value={specVariety} onChange={(e) => setSpecVariety(e.target.value)} /></Field>
                <Field label="Avg length"><input className="ef-input" type="number" step="0.01" value={specAvgLength} onChange={(e) => setSpecAvgLength(e.target.value)} /></Field>
                <Field label="Moisture"><input className="ef-input" type="number" step="0.01" value={specMoisture} onChange={(e) => setSpecMoisture(e.target.value)} /></Field>
                <Field label="Broken"><input className="ef-input" type="number" step="0.01" value={specBroken} onChange={(e) => setSpecBroken(e.target.value)} /></Field>
                <Field label="Crop year"><input className="ef-input" value={specCrop} onChange={(e) => setSpecCrop(e.target.value)} /></Field>
              </div>
              <div className="flex items-center gap-2">
                <button className="ef-btn ef-btn-primary" onClick={() => { setEditingLine(null); setShowAddLine(true); }}><Plus className="w-3.5 h-3.5" /> Add line</button>
                <button className="ef-btn" disabled={!selectedLineId} onClick={editSelected}><Pencil className="w-3.5 h-3.5" /> Edit line</button>
                <button className="ef-btn ef-btn-danger" disabled={!selectedLineId} onClick={removeSelected}><Trash2 className="w-3.5 h-3.5" /> Remove</button>
              </div>
              <div className="ef-card overflow-hidden">
                <div className="overflow-x-auto max-h-52 overflow-y-auto">
                  <table className="ef-table">
                    <thead><tr>
                      <th>Product</th><th>Packing</th><th className="text-right">Bags</th><th className="text-right">Net wt</th>
                      <th className="text-right">Gross</th><th className="text-right">Rate</th><th className="text-right">Amount</th>
                      <th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th>
                    </tr></thead>
                    <tbody>
                      {lines.length === 0 && <tr><td colSpan={10} className="text-center text-slate-400 py-4">No lines — click “Add line”.</td></tr>}
                      {lines.map((l) => (
                        <tr key={l.id} className={`cursor-pointer ${selectedLineId === l.id ? 'selected' : ''}`}
                          onClick={() => setSelectedLineId(l.id)} onDoubleClick={() => { setSelectedLineId(l.id); editSelected(); }}>
                          <td className="font-medium text-slate-800">{l.productName}</td>
                          <td className="text-slate-600">{l.packingText || '—'}</td>
                          <td className="text-right font-mono">{l.noOfBags}</td>
                          <td className="text-right font-mono">{l.quantityMt.toFixed(3)}</td>
                          <td className="text-right font-mono">{l.grossWtMt ? l.grossWtMt.toFixed(3) : '—'}</td>
                          <td className="text-right font-mono">{fmt(l.ratePerMt)}</td>
                          <td className="text-right font-mono font-semibold">{fmt(l.amount)}</td>
                          <td className="text-right font-mono">{fmt(l.cgst)}</td>
                          <td className="text-right font-mono">{fmt(l.sgst)}</td>
                          <td className="text-right font-mono">{fmt(l.igst)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <Field label="Milling / production instructions">
                <textarea className="ef-textarea" rows={2} value={millingInstructions} onChange={(e) => setMillingInstructions(e.target.value)} placeholder="Double polish, sortex clean, moisture < 12%…" />
              </Field>
            </div>
          )}

          {tab === 'terms' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="ef-check" checked={showSignature} onChange={(e) => setShowSignature(e.target.checked)} />
                Show signature / stamp on this document
              </label>
              <div className="ef-section-title">Tick the terms conditions to print on this production order:</div>
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

        {/* Footer totals */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 border-t border-slate-200 bg-slate-50 text-xs font-mono text-slate-700">
          <span>Lines: <b>{lines.length}</b></span>
          <span>Net wt: <b>{totals.netWt.toFixed(3)}</b></span>
          <span>Bags: <b>{totals.bags}</b></span>
          <span>Amount: <b>{fmt(totals.amount)}</b></span>
          <span>GST: <b>{fmt(totals.gst)}</b></span>
        </div>
      </div>

      {showAddLine && (
        <ProductionAddLineDialog
          products={master.products}
          packingTypes={master.packingTypes}
          initial={editingLine}
          onSave={upsertLine}
          onClose={() => { setShowAddLine(false); setEditingLine(null); }}
        />
      )}
    </div>
  );
}
