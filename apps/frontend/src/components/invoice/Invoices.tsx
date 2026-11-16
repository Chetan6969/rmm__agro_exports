'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FilePlus2, FolderOpen, Trash2, RefreshCw, Printer, Download, Loader2, Receipt,
} from 'lucide-react';
import { api, type CommercialInvoiceListItem } from '../../lib/api';
import { InvoiceFormDialog, type InvMasterData } from './InvoiceFormDialog';

function StatusChip({ status }: { status: string }) {
  const s = status.toUpperCase();
  const cls =
    s === 'FINAL' || s === 'PAID' ? 'ef-chip ef-chip-confirmed'
      : s === 'CANCELLED' ? 'ef-chip ef-chip-cancelled'
        : 'ef-chip ef-chip-open';
  return <span className={cls}>{status}</span>;
}

export function Invoices() {
  const [list, setList] = useState<CommercialInvoiceListItem[]>([]);
  const [master, setMaster] = useState<InvMasterData | null>(null);
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
      setList(await api.listInvoices());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMaster = useCallback(async () => {
    try {
      const [customers, products, packingTypes, ports, banks, terms, shippingLines, productionOrders, countries] =
        await Promise.all([
          api.customers(), api.products(), api.packingTypes(), api.ports(),
          api.bankDetails(), api.terms('PROFORMA'), api.shippingLines(), api.listProductionOrders(), api.countries(),
        ]);
      setMaster({ customers, products, packingTypes, ports, banks, terms, shippingLines, productionOrders, countries });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load master data');
    }
  }, []);

  useEffect(() => { void loadList(); void loadMaster(); }, [loadList, loadMaster]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      p.documentNumber.toLowerCase().includes(q) ||
      (p.customerName || '').toLowerCase().includes(q) ||
      (p.orderNumber || '').toLowerCase().includes(q));
  }, [list, search]);

  const openPdf = (id: string) => window.open(api.invoicePdfUrl(id), '_blank');

  const handleDelete = async () => {
    if (!selectedId) return;
    const inv = list.find((p) => p.id === selectedId);
    if (!inv) return;
    if (!window.confirm(`Delete invoice ${inv.documentNumber}?`)) return;
    try {
      await api.deleteInvoice(selectedId);
      setSelectedId(null);
      await loadList();
      setToast('Invoice deleted.');
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const onSaved = async (docNumber: string) => {
    setShowDialog(false);
    await loadList();
    setToast(`Invoice ${docNumber} saved.`);
    setTimeout(() => setToast(null), 4000);
  };

  const fmt = (n: string) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
        <Receipt className="w-5 h-5 text-blue-700" /> Invoices
      </h1>

      {toast && <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{toast}</div>}
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input className="ef-input w-64" placeholder="Search invoice no / name / order" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="ef-btn ef-btn-primary" onClick={() => setShowDialog(true)} disabled={!master}><FilePlus2 className="w-3.5 h-3.5" /> New</button>
        <button className="ef-btn" disabled={!selectedId} onClick={() => selectedId && openPdf(selectedId)}><FolderOpen className="w-3.5 h-3.5" /> Open</button>
        <button className="ef-btn ef-btn-danger" disabled={!selectedId} onClick={handleDelete}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        <button className="ef-btn" onClick={loadList}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        <button className="ef-btn ef-btn-primary" disabled={!selectedId} onClick={() => selectedId && openPdf(selectedId)}><Printer className="w-3.5 h-3.5" /> Preview / Print</button>
        <button className="ef-btn" disabled={!selectedId} onClick={() => selectedId && openPdf(selectedId)}><Download className="w-3.5 h-3.5" /> Save PDF</button>
      </div>

      <div className="ef-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ef-table">
            <thead><tr>
              <th>InvoiceNo</th><th>Date</th><th>Name</th><th>Order</th><th className="text-right">Amount</th><th>Status</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="text-center py-6 text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-slate-400">No invoices yet — click “New”.</td></tr>}
              {!loading && filtered.map((p) => (
                <tr key={p.id} className={`cursor-pointer ${selectedId === p.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(p.id)} onDoubleClick={() => openPdf(p.id)}>
                  <td className="font-mono font-semibold text-slate-800">{p.documentNumber}</td>
                  <td className="text-slate-600 font-mono">{p.documentDate}</td>
                  <td className="text-slate-700">{p.customerName || '—'}</td>
                  <td className="text-slate-600 font-mono">{p.orderNumber || '—'}</td>
                  <td className="text-right font-mono font-semibold">{p.currency} {fmt(p.totalInvoiceAmount)}</td>
                  <td><StatusChip status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">{filtered.length} invoice(s)</div>
      </div>

      {showDialog && master && (
        <InvoiceFormDialog master={master} onSaved={onSaved} onClose={() => setShowDialog(false)} />
      )}
    </div>
  );
}
