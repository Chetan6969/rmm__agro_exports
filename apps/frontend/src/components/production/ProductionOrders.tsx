'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FilePlus2, FolderOpen, Trash2, RefreshCw, Printer, Loader2, Factory,
} from 'lucide-react';
import { api, type ProductionOrderListItem } from '../../lib/api';
import { ProductionOrderFormDialog, type ProdMasterData } from './ProductionOrderFormDialog';

function StatusChip({ status }: { status: string }) {
  const s = status.toUpperCase();
  const cls =
    s === 'COMPLETED' ? 'ef-chip ef-chip-confirmed'
      : s === 'CANCELLED' ? 'ef-chip ef-chip-cancelled'
        : 'ef-chip ef-chip-open';
  return <span className={cls}>{status}</span>;
}

export function ProductionOrders() {
  const [list, setList] = useState<ProductionOrderListItem[]>([]);
  const [master, setMaster] = useState<ProdMasterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await api.listProductionOrders());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMaster = useCallback(async () => {
    try {
      const [customers, products, packingTypes, ports, terms, proformas, countries] = await Promise.all([
        api.customers(), api.products(), api.packingTypes(), api.ports(), api.terms('PROFORMA'), api.listProformas(), api.countries(),
      ]);
      setMaster({ customers, products, packingTypes, ports, terms, proformas, countries });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load master data');
    }
  }, []);

  useEffect(() => { void loadList(); void loadMaster(); }, [loadList, loadMaster]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      p.documentNumber.toLowerCase().includes(q) || (p.customerName || '').toLowerCase().includes(q));
  }, [list, search]);

  const openPdf = (id: string) => window.open(api.productionOrderPdfUrl(id), '_blank');

  const handleDelete = async () => {
    if (!selectedId) return;
    const po = list.find((p) => p.id === selectedId);
    if (!po) return;
    if (!window.confirm(`Delete production order ${po.documentNumber}?`)) return;
    try {
      await api.deleteProductionOrder(selectedId);
      setSelectedId(null);
      await loadList();
      setToast('Production order deleted.');
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const onSaved = async (docNumber: string) => {
    setShowDialog(false);
    await loadList();
    setToast(`Production order ${docNumber} saved.`);
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
        <Factory className="w-5 h-5 text-blue-700" /> Production Orders
      </h1>

      {toast && <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{toast}</div>}
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input className="ef-input w-56" placeholder="Search order no / customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="ef-btn ef-btn-primary" onClick={() => setShowDialog(true)} disabled={!master}><FilePlus2 className="w-3.5 h-3.5" /> New</button>
        <button className="ef-btn" disabled={!selectedId} onClick={() => selectedId && openPdf(selectedId)}><FolderOpen className="w-3.5 h-3.5" /> Open</button>
        <button className="ef-btn ef-btn-danger" disabled={!selectedId} onClick={handleDelete}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        <button className="ef-btn" onClick={loadList}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        <button className="ef-btn ef-btn-primary" disabled={!selectedId} onClick={() => selectedId && openPdf(selectedId)}><Printer className="w-3.5 h-3.5" /> Preview / Print</button>
      </div>

      <div className="ef-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ef-table">
            <thead><tr>
              <th>OrderNo</th><th>Date</th><th>Customer</th><th>Status</th><th className="text-right">Invoice</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="text-center py-6 text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-slate-400">No production orders yet — click “New”.</td></tr>}
              {!loading && filtered.map((p) => (
                <tr key={p.id} className={`cursor-pointer ${selectedId === p.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(p.id)} onDoubleClick={() => openPdf(p.id)}>
                  <td className="font-mono font-semibold text-slate-800">{p.documentNumber}</td>
                  <td className="text-slate-600 font-mono">{p.documentDate}</td>
                  <td className="text-slate-700">{p.customerName || '—'}</td>
                  <td><StatusChip status={p.status} /></td>
                  <td className="text-right font-mono">{p.invoiceCount || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">{filtered.length} order(s)</div>
      </div>

      {showDialog && master && (
        <ProductionOrderFormDialog master={master} onSaved={onSaved} onClose={() => setShowDialog(false)} />
      )}
    </div>
  );
}
