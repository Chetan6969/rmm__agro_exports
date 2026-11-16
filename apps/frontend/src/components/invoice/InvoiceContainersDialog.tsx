'use client';

import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { InvContainerDraft } from './types';

interface Props {
  containers: InvContainerDraft[];
  onChange: (containers: InvContainerDraft[]) => void;
  onClose: () => void;
}

const newId = () => `ct-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const blank = (): InvContainerDraft => ({
  id: newId(),
  containerNumber: '',
  sealNumber: '',
  containerSize: '20FT',
  totalBags: 0,
  grossWeightKg: 0,
  netWeightKg: 0,
});

export function InvoiceContainersDialog({ containers, onChange, onClose }: Props) {
  const [rows, setRows] = useState<InvContainerDraft[]>(
    containers.length ? containers : [blank()],
  );

  const update = (id: string, field: keyof InvContainerDraft, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              [field]:
                field === 'totalBags' ||
                field === 'grossWeightKg' ||
                field === 'netWeightKg'
                  ? parseFloat(value) || 0
                  : value,
            }
          : r,
      ),
    );
  };

  const save = () => {
    onChange(rows.filter((r) => r.containerNumber.trim()));
    onClose();
  };

  return (
    <div className="ef-overlay" onMouseDown={onClose}>
      <div className="ef-modal max-w-3xl mt-10" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-bar">
          <span>Containers / Packing</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <button className="ef-btn ef-btn-primary" onClick={() => setRows((p) => [...p, blank()])}>
            <Plus className="w-3.5 h-3.5" /> Add container
          </button>
          <div className="ef-card overflow-hidden">
            <table className="ef-table">
              <thead><tr>
                <th>Container no</th><th>Seal no</th><th>Size</th>
                <th className="text-right">Bags</th><th className="text-right">Gross (KG)</th><th className="text-right">Net (KG)</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><input className="ef-input py-1" value={r.containerNumber} onChange={(e) => update(r.id, 'containerNumber', e.target.value)} /></td>
                    <td><input className="ef-input py-1" value={r.sealNumber} onChange={(e) => update(r.id, 'sealNumber', e.target.value)} /></td>
                    <td><input className="ef-input py-1 w-16" value={r.containerSize} onChange={(e) => update(r.id, 'containerSize', e.target.value)} /></td>
                    <td><input className="ef-input py-1 w-20 text-right" type="number" value={r.totalBags || ''} onChange={(e) => update(r.id, 'totalBags', e.target.value)} /></td>
                    <td><input className="ef-input py-1 w-24 text-right" type="number" value={r.grossWeightKg || ''} onChange={(e) => update(r.id, 'grossWeightKg', e.target.value)} /></td>
                    <td><input className="ef-input py-1 w-24 text-right" type="number" value={r.netWeightKg || ''} onChange={(e) => update(r.id, 'netWeightKg', e.target.value)} /></td>
                    <td className="text-center">
                      <button className="text-red-500 hover:text-red-700" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))}><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-md">
          <button className="ef-btn ef-btn-primary" onClick={save}>Save</button>
          <button className="ef-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
