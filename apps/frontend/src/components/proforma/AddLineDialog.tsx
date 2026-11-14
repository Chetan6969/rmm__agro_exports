'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PackingType, Product } from '../../lib/api';
import type { LineDraft } from './types';

interface Props {
  products: Product[];
  packingTypes: PackingType[];
  initial?: LineDraft | null;
  onSave: (line: LineDraft, addAnother: boolean) => void;
  onClose: () => void;
}

const newId = () => `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function AddLineDialog({
  products,
  packingTypes,
  initial,
  onSave,
  onClose,
}: Props) {
  const [productId, setProductId] = useState(initial?.productId || products[0]?.id || '');
  const [packingTypeId, setPackingTypeId] = useState(
    initial?.packingTypeId || packingTypes[0]?.id || '',
  );
  const [packingText, setPackingText] = useState(initial?.packingText || '');
  const [hsCode, setHsCode] = useState(initial?.hsCode || '');
  const [cropYear, setCropYear] = useState(initial?.cropYear || '');
  const [quantityMt, setQuantityMt] = useState(initial?.quantityMt ? String(initial.quantityMt) : '');
  const [ratePerMt, setRatePerMt] = useState(initial?.ratePerMt ? String(initial.ratePerMt) : '');
  const [cgst, setCgst] = useState(initial?.cgst ? String(initial.cgst) : '');
  const [sgst, setSgst] = useState(initial?.sgst ? String(initial.sgst) : '');
  const [igst, setIgst] = useState(initial?.igst ? String(initial.igst) : '');
  const [brokenPct, setBrokenPct] = useState(initial?.brokenPct ? String(initial.brokenPct) : '');
  const [error, setError] = useState<string | null>(null);

  const qty = parseFloat(quantityMt) || 0;
  const rate = parseFloat(ratePerMt) || 0;
  const amount = Math.round(qty * rate * 100) / 100;

  const build = (): LineDraft | null => {
    const product = products.find((p) => p.id === productId);
    const packing = packingTypes.find((p) => p.id === packingTypeId);
    if (!product) {
      setError('Select a product');
      return null;
    }
    if (!packing) {
      setError('Select a packing type');
      return null;
    }
    if (qty <= 0) {
      setError('Quantity must be greater than 0');
      return null;
    }
    if (rate <= 0) {
      setError('Rate must be greater than 0');
      return null;
    }
    return {
      id: initial?.id || newId(),
      productId,
      productName: product.name,
      packingTypeId,
      packingName: packing.name,
      packingText,
      hsCode: hsCode || product.hsnCode,
      cropYear,
      quantityMt: qty,
      ratePerMt: rate,
      amount,
      cgst: parseFloat(cgst) || 0,
      sgst: parseFloat(sgst) || 0,
      igst: parseFloat(igst) || 0,
      brokenPct: brokenPct ? parseFloat(brokenPct) : undefined,
    };
  };

  const handle = (addAnother: boolean) => {
    const line = build();
    if (line) onSave(line, addAnother);
  };

  return (
    <div className="ef-overlay" onMouseDown={onClose}>
      <div
        className="ef-modal max-w-md mt-10"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ef-modal-bar">
          <span>{initial ? 'Edit line' : 'Add line'}</span>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="ef-label">Product *</label>
            <select
              className="ef-select"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="ef-label">Packing type *</label>
            <select
              className="ef-select"
              value={packingTypeId}
              onChange={(e) => setPackingTypeId(e.target.value)}
            >
              {packingTypes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="ef-label">Packing + qty (one per line)</label>
            <textarea
              className="ef-textarea"
              rows={3}
              placeholder={'1. 30KG BOPP BAGS 1000MT\n2. 25KG BOPP BAGS 500MT'}
              value={packingText}
              onChange={(e) => setPackingText(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ef-label">HS Code</label>
              <input className="ef-input" value={hsCode} onChange={(e) => setHsCode(e.target.value)} />
            </div>
            <div>
              <label className="ef-label">Crop year</label>
              <input className="ef-input" value={cropYear} onChange={(e) => setCropYear(e.target.value)} />
            </div>
            <div>
              <label className="ef-label">Total Qty (MT) *</label>
              <input
                className="ef-input"
                type="number"
                step="0.001"
                value={quantityMt}
                onChange={(e) => setQuantityMt(e.target.value)}
              />
            </div>
            <div>
              <label className="ef-label">Rate *</label>
              <input
                className="ef-input"
                type="number"
                step="0.01"
                value={ratePerMt}
                onChange={(e) => setRatePerMt(e.target.value)}
              />
            </div>
            <div>
              <label className="ef-label">Amount</label>
              <input
                className="ef-input"
                disabled
                value={amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              />
            </div>
            <div>
              <label className="ef-label">Broken %</label>
              <input className="ef-input" type="number" step="0.01" value={brokenPct} onChange={(e) => setBrokenPct(e.target.value)} />
            </div>
            <div>
              <label className="ef-label">CGST</label>
              <input className="ef-input" type="number" step="0.01" value={cgst} onChange={(e) => setCgst(e.target.value)} />
            </div>
            <div>
              <label className="ef-label">SGST</label>
              <input className="ef-input" type="number" step="0.01" value={sgst} onChange={(e) => setSgst(e.target.value)} />
            </div>
            <div>
              <label className="ef-label">IGST</label>
              <input className="ef-input" type="number" step="0.01" value={igst} onChange={(e) => setIgst(e.target.value)} />
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-md">
          {!initial && (
            <button className="ef-btn" onClick={() => handle(true)}>
              Save &amp; add another
            </button>
          )}
          <button className="ef-btn ef-btn-primary" onClick={() => handle(false)}>
            OK
          </button>
          <button className="ef-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
