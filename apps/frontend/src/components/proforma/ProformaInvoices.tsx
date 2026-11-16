'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FilePlus2,
  FolderOpen,
  Trash2,
  RefreshCw,
  Printer,
  BarChart3,
  Loader2,
  FileText,
} from 'lucide-react';
import { api, type ProformaListItem } from '../../lib/api';
import { ProformaFormDialog, type MasterData } from './ProformaFormDialog';
import { ProformaReports } from './ProformaReports';

function StatusChip({ status }: { status: string }) {
  const s = status.toUpperCase();
  const cls =
    s === 'CONFIRMED' || s === 'FULFILLED'
      ? 'ef-chip ef-chip-confirmed'
      : s === 'CANCELLED'
        ? 'ef-chip ef-chip-cancelled'
        : 'ef-chip ef-chip-open';
  return <span className={cls}>{status}</span>;
}

export function ProformaInvoices() {
  const [list, setList] = useState<ProformaListItem[]>([]);
  const [master, setMaster] = useState<MasterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await api.listProformas());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMaster = useCallback(async () => {
    try {
      const [customers, products, packingTypes, ports, banks, terms, countries] =
        await Promise.all([
          api.customers(),
          api.products(),
          api.packingTypes(),
          api.ports(),
          api.bankDetails(),
          api.terms('PROFORMA'),
          api.countries(),
        ]);
      setMaster({ customers, products, packingTypes, ports, banks, terms, countries });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load master data');
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadMaster();
  }, [loadList, loadMaster]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.documentNumber.toLowerCase().includes(q) ||
        (p.consigneeName || '').toLowerCase().includes(q),
    );
  }, [list, search]);

  const openPdf = (id: string) => window.open(api.proformaPdfUrl(id), '_blank');

  const handleDelete = async () => {
    if (!selectedId) return;
    const pi = list.find((p) => p.id === selectedId);
    if (!pi) return;
    if (!window.confirm(`Delete proforma ${pi.documentNumber}? This can be undone by an admin.`)) return;
    try {
      await api.deleteProforma(selectedId);
      setSelectedId(null);
      await loadList();
      setToast('Proforma deleted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const onSaved = async (docNumber: string) => {
    setShowDialog(false);
    await loadList();
    setToast(`Proforma ${docNumber} saved.`);
    setTimeout(() => setToast(null), 4000);
  };

  const fmt = (n: string) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-3">
      {/* Title */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-700" />
          Proforma Invoices
        </h1>
        <button
          className={`ef-btn ${showReports ? 'ef-btn-primary' : ''}`}
          onClick={() => setShowReports((v) => !v)}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {showReports ? 'Back to list' : 'Reports'}
        </button>
      </div>

      {toast && (
        <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
          {toast}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {showReports ? (
        <div className="ef-card p-4">
          <ProformaReports />
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="ef-input w-56"
              placeholder="Search no / customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="ef-btn ef-btn-primary"
              onClick={() => setShowDialog(true)}
              disabled={!master}
            >
              <FilePlus2 className="w-3.5 h-3.5" /> New
            </button>
            <button className="ef-btn" disabled={!selectedId} onClick={() => selectedId && openPdf(selectedId)}>
              <FolderOpen className="w-3.5 h-3.5" /> Open
            </button>
            <button className="ef-btn ef-btn-danger" disabled={!selectedId} onClick={handleDelete}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button className="ef-btn" onClick={loadList}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button className="ef-btn ef-btn-primary" disabled={!selectedId} onClick={() => selectedId && openPdf(selectedId)}>
              <Printer className="w-3.5 h-3.5" /> Preview / Print
            </button>
          </div>

          {/* List */}
          <div className="ef-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="ef-table">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Consignee</th>
                    <th>Date</th>
                    <th>Incoterm</th>
                    <th className="text-right">Grand total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={6} className="text-center py-6 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin inline" /> Loading…
                    </td></tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-slate-400">
                      No proforma invoices yet — click “New”.
                    </td></tr>
                  )}
                  {!loading && filtered.map((p) => (
                    <tr
                      key={p.id}
                      className={`cursor-pointer ${selectedId === p.id ? 'selected' : ''}`}
                      onClick={() => setSelectedId(p.id)}
                      onDoubleClick={() => openPdf(p.id)}
                    >
                      <td className="font-mono font-semibold text-slate-800">{p.documentNumber}</td>
                      <td className="text-slate-700">{p.consigneeName || '—'}</td>
                      <td className="text-slate-600 font-mono">{p.documentDate}</td>
                      <td>{p.incoterm}</td>
                      <td className="text-right font-mono font-semibold">
                        {p.currency} {fmt(p.grandTotal)}
                      </td>
                      <td><StatusChip status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
              {filtered.length} proforma(s)
            </div>
          </div>
        </>
      )}

      {showDialog && master && (
        <ProformaFormDialog
          master={master}
          onSaved={onSaved}
          onClose={() => setShowDialog(false)}
        />
      )}
    </div>
  );
}
