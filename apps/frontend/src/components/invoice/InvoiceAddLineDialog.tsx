'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PackingType, Product } from '../../lib/api';
import type { InvLineDraft } from './types';

interface Props {
  products: Product[];
  packingTypes: PackingType[];
  initial?: InvLineDraft | null;
  onSave: (line: InvLineDraft, addAnother: boolean) => void;
  onClose: () => void;
}

const newId = () => `il-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function InvoiceAddLineDialog({
  products,
  packingTypes,
  initial,
  onSave,
  onClose,
}: Props) {
  const [productId, setProductId] = useState(initial?.productId || products[0]?.id || '');
  const [packingTypeId, setPackingTypeId] = useState(initial?.packingTypeId || '');
  const [packingText, setPackingText] = useState(initial?.packingText || '');
  const [noOfBags, setNoOfBags] = useState(initial?.noOfBags ? String(initial.noOfBags) : '');
  const [quantityMt, setQuantityMt] = useState(initial?.quantityMt ? String(initial.quantityMt) : '');
  const [grossWtMt, setGrossWtMt] = useState(initial?.grossWtMt ? String(initial.grossWtMt) : '');
  const [ratePerMt, setRatePerMt] = useState(initial?.ratePerMt ? String(initial.ratePerMt) : '');
  const [cgst, setCgst] = useState(initial?.cgst ? String(initial.cgst) : '');
  const [sgst, setSgst] = useState(initial?.sgst ? String(initial.sgst) : '');
  const [igst, setIgst] = useState(initial?.igst ? String(initial.igst) : '');
  const [brokenBelow, setBrokenBelow] = useState(initial?.brokenBelow ?? false);
  const [fcl, setFcl] = useState(initial?.fcl ?? false);
  const [error, setError] = useState<string | null>(null);

  const qty = parseFloat(quantityMt) || 0;
  const rate = parseFloat(ratePerMt) || 0;
  const amount = Math.round(qty * rate * 100) / 100;

  const handle = (addAnother: boolean) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return setError('Select a product');
    if (qty <= 0) return setError('Net weight must be greater than 0');
    if (rate <= 0) return setError('Rate must be greater than 0');
    onSave(
      {
        id: initial?.id || newId(),
        productId,
        productName: product.name,
        packingTypeId,
        packingText,
        hsCode: initial?.hsCode || product.hsnCode,
        noOfBags: parseInt(noOfBags) || 0,
        quantityMt: qty,
        grossWtMt: grossWtMt ? parseFloat(grossWtMt) : undefined,
        ratePerMt: rate,
        amount,
        cgst: parseFloat(cgst) || 0,
        sgst: parseFloat(sgst) || 0,
        igst: parseFloat(igst) || 0,
        brokenBelow,
        fcl,
      },
      addAnother,
    );
  };

  return (
    <div className="ef-overlay" onMouseDown={onClose}>
      <div className="ef-modal max-w-md mt-10" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-bar">
          <span>{initial ? 'Edit line' : 'Add line'}</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="ef-label">Product *</label>
            <select className="ef-select" value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="ef-label">Packing</label>
            <select className="ef-select mb-1.5" value={packingTypeId} onChange={(e) => setPackingTypeId(e.target.value)}>
              <option value="">— select packing type —</option>
              {packingTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="ef-input" placeholder="Free-text packing (optional)" value={packingText} onChange={(e) => setPackingText(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="ef-label">No. of bags</label><input className="ef-input" type="number" value={noOfBags} onChange={(e) => setNoOfBags(e.target.value)} /></div>
            <div><label className="ef-label">Net wt (MT) *</label><input className="ef-input" type="number" step="0.001" value={quantityMt} onChange={(e) => setQuantityMt(e.target.value)} /></div>
            <div><label className="ef-label">Gross wt (MT)</label><input className="ef-input" type="number" step="0.001" value={grossWtMt} onChange={(e) => setGrossWtMt(e.target.value)} /></div>
            <div><label className="ef-label">Rate *</label><input className="ef-input" type="number" step="0.01" value={ratePerMt} onChange={(e) => setRatePerMt(e.target.value)} /></div>
            <div><label className="ef-label">Amount</label><input className="ef-input" disabled value={amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} /></div>
            <div><label className="ef-label">CGST</label><input className="ef-input" type="number" step="0.01" value={cgst} onChange={(e) => setCgst(e.target.value)} /></div>
            <div><label className="ef-label">SGST</label><input className="ef-input" type="number" step="0.01" value={sgst} onChange={(e) => setSgst(e.target.value)} /></div>
            <div><label className="ef-label">IGST</label><input className="ef-input" type="number" step="0.01" value={igst} onChange={(e) => setIgst(e.target.value)} /></div>
          </div>
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"><input type="checkbox" className="ef-check" checked={brokenBelow} onChange={(e) => setBrokenBelow(e.target.checked)} /> Broken below</label>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"><input type="checkbox" className="ef-check" checked={fcl} onChange={(e) => setFcl(e.target.checked)} /> FCL</label>
          </div>
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1.5">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-md">
          {!initial && <button className="ef-btn" onClick={() => handle(true)}>Save &amp; add another</button>}
          <button className="ef-btn ef-btn-primary" onClick={() => handle(false)}>OK</button>
          <button className="ef-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
