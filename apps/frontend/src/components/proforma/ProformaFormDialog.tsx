'use client';

import React, { useMemo, useState } from 'react';
import { X, Plus, Pencil, Trash2, ListChecks, Save, Loader2 } from 'lucide-react';
import {
  api,
  type BankDetail,
  type CreateProformaInput,
  type Customer,
  type PackingType,
  type Port,
  type Product,
  type Term,
} from '../../lib/api';
import { AddLineDialog } from './AddLineDialog';
import { TermsSectionsPanel } from './TermsSectionsPanel';
import { DEFAULT_SECTIONS, type LineDraft, type SectionToggles } from './types';

export interface MasterData {
  customers: Customer[];
  products: Product[];
  packingTypes: PackingType[];
  ports: Port[];
  banks: BankDetail[];
  terms: Term[];
  countries: { name: string }[];
}

interface Props {
  master: MasterData;
  onSaved: (documentNumber: string) => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function ProformaFormDialog({ master, onSaved, onClose }: Props) {
  const loadingPorts = master.ports.filter(
    (p) => p.portType === 'LOADING' || p.portType === 'BOTH',
  );
  const dischargePorts = master.ports.filter(
    (p) => p.portType === 'DISCHARGE' || p.portType === 'BOTH',
  );

  const [documentNumber, setDocumentNumber] = useState('');
  const [documentDate, setDocumentDate] = useState(today());
  const [consigneeId, setConsigneeId] = useState(master.customers[0]?.id || '');
  const [buyerId, setBuyerId] = useState(''); // '' = same as consignee
  const [notifyPartyId, setNotifyPartyId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('LC AT SIGHT');
  const [status, setStatus] = useState('CONFIRMED');

  const [buyerPoRef, setBuyerPoRef] = useState('');
  const [poDateOn, setPoDateOn] = useState(false);
  const [poDate, setPoDate] = useState(today());
  const [lcNumber, setLcNumber] = useState('');
  const [lcDateOn, setLcDateOn] = useState(false);
  const [lcDate, setLcDate] = useState(today());
  const [currency, setCurrency] = useState('USD');
  const [incoterm, setIncoterm] = useState<'FOB' | 'CFR' | 'CIF'>('FOB');
  const [exchangeRate, setExchangeRate] = useState('');

  const [goodsCountry, setGoodsCountry] = useState('INDIA');
  const [portOfLoading, setPortOfLoading] = useState(loadingPorts[0]?.name || 'Mundra');
  const [finalDestination, setFinalDestination] = useState('');
  const [portOfDischarge, setPortOfDischarge] = useState(dischargePorts[0]?.name || '');
  const [brand, setBrand] = useState('');
  const [blend, setBlend] = useState('');
  const [freight, setFreight] = useState('0');
  const [insurance, setInsurance] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [deliveryTimeline, setDeliveryTimeline] = useState('');

  const [specVariety, setSpecVariety] = useState('');
  const [specAvgLength, setSpecAvgLength] = useState('');
  const [specMoisture, setSpecMoisture] = useState('');
  const [specBroken, setSpecBroken] = useState('');
  const [specCrop, setSpecCrop] = useState('');

  const [bankDetailsId, setBankDetailsId] = useState(
    master.banks.find((b) => b.isDefault)?.id || master.banks[0]?.id || '',
  );

  const [lines, setLines] = useState<LineDraft[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const [sections, setSections] = useState<SectionToggles>(DEFAULT_SECTIONS);
  const [selectedTermIds, setSelectedTermIds] = useState<Set<string>>(
    () => new Set(master.terms.filter((t) => t.isDefault).map((t) => t.id)),
  );

  const [showAddLine, setShowAddLine] = useState(false);
  const [editingLine, setEditingLine] = useState<LineDraft | null>(null);
  const [showTcPanel, setShowTcPanel] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const netWt = lines.reduce((s, l) => s + l.quantityMt, 0);
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    const gst = lines.reduce((s, l) => s + l.cgst + l.sgst + l.igst, 0);
    const grand =
      amount +
      (parseFloat(freight) || 0) +
      (parseFloat(insurance) || 0) -
      (parseFloat(discount) || 0);
    return { netWt, amount, gst, grand };
  }, [lines, freight, insurance, discount]);

  const upsertLine = (line: LineDraft, addAnother: boolean) => {
    setLines((prev) => {
      const exists = prev.some((l) => l.id === line.id);
      return exists ? prev.map((l) => (l.id === line.id ? line : l)) : [...prev, line];
    });
    setEditingLine(null);
    if (!addAnother) setShowAddLine(false);
  };

  const removeSelected = () => {
    if (selectedLineId) {
      setLines((prev) => prev.filter((l) => l.id !== selectedLineId));
      setSelectedLineId(null);
    }
  };

  const editSelected = () => {
    const line = lines.find((l) => l.id === selectedLineId);
    if (line) {
      setEditingLine(line);
      setShowAddLine(true);
    }
  };

  const toggleTerm = (id: string) =>
    setSelectedTermIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSection = (key: keyof SectionToggles) =>
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const save = async () => {
    setError(null);
    if (!documentNumber.trim()) return setError('Enter a Proforma number');
    if (!consigneeId) return setError('Select a consignee');
    if (lines.length === 0) return setError('Add at least one product line');
    if (!paymentTerms.trim()) return setError('Payment terms are required');

    const terms = Array.from(selectedTermIds)
      .map((id) => master.terms.find((t) => t.id === id))
      .filter((t): t is Term => Boolean(t))
      .map((t) => ({ termId: t.id, content: t.content }));

    const dto: CreateProformaInput = {
      documentNumber: documentNumber.trim(),
      documentDate,
      status,
      customerId: consigneeId,
      consigneeId: buyerId || undefined,
      notifyPartyId: notifyPartyId || undefined,
      buyerPoRef: buyerPoRef || undefined,
      poDate: poDateOn ? poDate : undefined,
      lcNumber: lcNumber || undefined,
      lcDate: lcDateOn ? lcDate : undefined,
      incoterm,
      currency,
      exchangeRate: exchangeRate ? parseFloat(exchangeRate) : undefined,
      paymentTerms,
      deliveryTimeline: deliveryTimeline || undefined,
      countryOfOrigin: goodsCountry || 'India',
      goodsCountry: goodsCountry || undefined,
      portOfLoading,
      portOfDischarge: portOfDischarge || 'N/A',
      finalDestination: finalDestination || 'N/A',
      brand: brand || undefined,
      blend: blend || undefined,
      specVariety: specVariety || undefined,
      specAvgLengthMm: specAvgLength ? parseFloat(specAvgLength) : undefined,
      specMoisturePct: specMoisture ? parseFloat(specMoisture) : undefined,
      specBrokenPct: specBroken ? parseFloat(specBroken) : undefined,
      specCropYear: specCrop || undefined,
      bankDetailsId: bankDetailsId || undefined,
      freightAmount: parseFloat(freight) || 0,
      insuranceAmount: parseFloat(insurance) || 0,
      discountAmount: parseFloat(discount) || 0,
      ...sections,
      terms,
      items: lines.map((l) => ({
        productId: l.productId,
        packingTypeId: l.packingTypeId,
        packingText: l.packingText || undefined,
        hsCode: l.hsCode || undefined,
        cropYear: l.cropYear || undefined,
        quantityMt: l.quantityMt,
        ratePerMt: l.ratePerMt,
        brokenPct: l.brokenPct,
        cgst: l.cgst,
        sgst: l.sgst,
        igst: l.igst,
      })),
    };

    setSaving(true);
    try {
      const res = await api.createProforma(dto);
      onSaved(res.documentNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="ef-overlay" onMouseDown={onClose}>
      <div
        className="ef-modal max-w-6xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ef-modal-bar">
          <span>New Proforma Invoice</span>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action buttons row */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
          <span className="ef-section-title mr-2">Product lines</span>
          <button className="ef-btn ef-btn-primary" onClick={() => { setEditingLine(null); setShowAddLine(true); }}>
            <Plus className="w-3.5 h-3.5" /> Add line
          </button>
          <button className="ef-btn" disabled={!selectedLineId} onClick={editSelected}>
            <Pencil className="w-3.5 h-3.5" /> Edit line
          </button>
          <button className="ef-btn ef-btn-danger" disabled={!selectedLineId} onClick={removeSelected}>
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </button>
          <button className="ef-btn" onClick={() => setShowTcPanel(true)}>
            <ListChecks className="w-3.5 h-3.5" /> TC / Sections…
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button className="ef-btn ef-btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Proforma
            </button>
            <button className="ef-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>

        <div className="p-4 space-y-4 max-h-[72vh] overflow-y-auto">
          {/* Header fields grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5 gap-y-2.5">
            {/* Column 1 */}
            <div className="space-y-2.5">
              <div>
                <label className="ef-label">Proforma no *</label>
                <input
                  className="ef-input"
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  placeholder="e.g. PI-RMM/AM/1015"
                />
              </div>
              <div>
                <label className="ef-label">Date</label>
                <input className="ef-input" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
              </div>
              <div>
                <label className="ef-label">Consignee *</label>
                <select className="ef-select" value={consigneeId} onChange={(e) => setConsigneeId(e.target.value)}>
                  {master.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="ef-label">Buyer *</label>
                <select className="ef-select" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">— same as consignee —</option>
                  {master.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="ef-label">Notify party</label>
                <select className="ef-select" value={notifyPartyId} onChange={(e) => setNotifyPartyId(e.target.value)}>
                  <option value="">— none —</option>
                  {master.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="ef-label">Payment terms</label>
                <input className="ef-input" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
              </div>
              <div>
                <label className="ef-label">Status</label>
                <select className="ef-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="DRAFT">Open / Draft</option>
                  <option value="FULFILLED">Fulfilled</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            </div>

            {/* Column 2 */}
            <div className="space-y-2.5">
              <div>
                <label className="ef-label">Buyer&apos;s PO / Ref</label>
                <input className="ef-input" value={buyerPoRef} onChange={(e) => setBuyerPoRef(e.target.value)} />
              </div>
              <div>
                <label className="ef-label">PO date</label>
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="ef-check" checked={poDateOn} onChange={(e) => setPoDateOn(e.target.checked)} />
                  <input className="ef-input" type="date" value={poDate} disabled={!poDateOn} onChange={(e) => setPoDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="ef-label">LC No.</label>
                <input className="ef-input" value={lcNumber} onChange={(e) => setLcNumber(e.target.value)} />
              </div>
              <div>
                <label className="ef-label">LC date</label>
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="ef-check" checked={lcDateOn} onChange={(e) => setLcDateOn(e.target.checked)} />
                  <input className="ef-input" type="date" value={lcDate} disabled={!lcDateOn} onChange={(e) => setLcDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="ef-label">Currency</label>
                <select className="ef-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {['USD', 'EUR', 'GBP', 'AED', 'INR'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="ef-label">Incoterms</label>
                <select className="ef-select" value={incoterm} onChange={(e) => setIncoterm(e.target.value as 'FOB' | 'CFR' | 'CIF')}>
                  <option value="FOB">FOB</option>
                  <option value="CFR">CFR</option>
                  <option value="CIF">CIF</option>
                </select>
              </div>
              <div>
                <label className="ef-label">Dollar rate</label>
                <input className="ef-input" type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="e.g. 83.50" />
              </div>
            </div>

            {/* Column 3 */}
            <div className="space-y-2.5">
              <div>
                <label className="ef-label">Goods country</label>
                <input className="ef-input" value={goodsCountry} onChange={(e) => setGoodsCountry(e.target.value)} />
              </div>
              <div>
                <label className="ef-label">Loading port</label>
                <select className="ef-select" value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)}>
                  {loadingPorts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  {loadingPorts.length === 0 && <option value="Mundra">Mundra</option>}
                </select>
              </div>
              <div>
                <label className="ef-label">Destination</label>
                <input className="ef-input" list="ef-countries" value={finalDestination} onChange={(e) => setFinalDestination(e.target.value)} placeholder="Country" />
                <datalist id="ef-countries">
                  {master.countries.map((c) => <option key={c.name} value={c.name} />)}
                </datalist>
              </div>
              <div>
                <label className="ef-label">Destination port</label>
                <select className="ef-select" value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)}>
                  <option value="">— select —</option>
                  {dischargePorts.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="ef-label">Brand</label>
                <input className="ef-input" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
              <div>
                <label className="ef-label">Blend</label>
                <input className="ef-input" value={blend} onChange={(e) => setBlend(e.target.value)} />
              </div>
              <div>
                <label className="ef-label">Freight</label>
                <input className="ef-input" type="number" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <label className="ef-label">Timeline (required)</label>
            <input
              className="ef-input"
              value={deliveryTimeline}
              onChange={(e) => setDeliveryTimeline(e.target.value)}
              placeholder="Delivery timeline / shipment schedule required from buyer"
            />
          </div>

          {/* Specification */}
          <div>
            <div className="ef-section-title mb-1.5">Specification</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div><label className="ef-label">Variety</label><input className="ef-input" value={specVariety} onChange={(e) => setSpecVariety(e.target.value)} /></div>
              <div><label className="ef-label">Avg length</label><input className="ef-input" type="number" step="0.01" value={specAvgLength} onChange={(e) => setSpecAvgLength(e.target.value)} /></div>
              <div><label className="ef-label">Moisture</label><input className="ef-input" type="number" step="0.01" value={specMoisture} onChange={(e) => setSpecMoisture(e.target.value)} /></div>
              <div><label className="ef-label">Broken</label><input className="ef-input" type="number" step="0.01" value={specBroken} onChange={(e) => setSpecBroken(e.target.value)} /></div>
              <div><label className="ef-label">Crop</label><input className="ef-input" value={specCrop} onChange={(e) => setSpecCrop(e.target.value)} /></div>
            </div>
          </div>

          {/* Product lines table */}
          <div className="ef-card overflow-hidden">
            <div className="overflow-x-auto max-h-56 overflow-y-auto">
              <table className="ef-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Packing</th>
                    <th className="text-right">Net wt</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">CGST</th>
                    <th className="text-right">SGST</th>
                    <th className="text-right">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-4">No product lines — click “Add line”.</td></tr>
                  )}
                  {lines.map((l) => (
                    <tr
                      key={l.id}
                      className={selectedLineId === l.id ? 'selected cursor-pointer' : 'cursor-pointer'}
                      onClick={() => setSelectedLineId(l.id)}
                      onDoubleClick={() => { setSelectedLineId(l.id); editSelected(); }}
                    >
                      <td className="font-medium text-slate-800">{l.productName}</td>
                      <td className="text-slate-600">{l.packingName}</td>
                      <td className="text-right font-mono">{l.quantityMt.toFixed(3)}</td>
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs font-mono text-slate-700">
              <span>Lines: <b>{lines.length}</b></span>
              <span>Net wt: <b>{totals.netWt.toFixed(3)}</b></span>
              <span>Amount: <b>{fmt(totals.amount)}</b></span>
              <span>GST: <b>{fmt(totals.gst)}</b></span>
              <span className="ml-auto flex items-center gap-4">
                <span>Freight: {fmt(parseFloat(freight) || 0)}</span>
                <span>Insurance:
                  <input className="ef-input inline-block w-24 ml-1 py-0.5" type="number" step="0.01" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
                </span>
                <span>Discount:
                  <input className="ef-input inline-block w-24 ml-1 py-0.5" type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </span>
                <span className="text-sm font-bold text-slate-900">Grand total ({currency}): {fmt(totals.grand)}</span>
              </span>
            </div>
          </div>

          {/* Bank + remittance selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="ef-label">Bank (for remittance)</label>
              <select className="ef-select" value={bankDetailsId} onChange={(e) => setBankDetailsId(e.target.value)}>
                <option value="">— none —</option>
                {master.banks.map((b) => (
                  <option key={b.id} value={b.id}>{b.bankName} — {b.accountNumber}</option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-500 flex items-end">
              {selectedTermIds.size} term(s) selected • sections configured via “TC / Sections…”.
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>
      </div>

      {showAddLine && (
        <AddLineDialog
          products={master.products}
          packingTypes={master.packingTypes}
          initial={editingLine}
          onSave={upsertLine}
          onClose={() => { setShowAddLine(false); setEditingLine(null); }}
        />
      )}
      {showTcPanel && (
        <TermsSectionsPanel
          terms={master.terms}
          selectedTermIds={selectedTermIds}
          sections={sections}
          onToggleTerm={toggleTerm}
          onToggleSection={toggleSection}
          onClose={() => setShowTcPanel(false)}
        />
      )}
    </div>
  );
}
