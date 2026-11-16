'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { FilePlus2, Pencil, Trash2, RefreshCw, Loader2, X, Save } from 'lucide-react';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'select' | 'checkbox' | 'textarea';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
}

export interface ColumnDef {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

export interface MasterConfig {
  title: string;
  icon?: React.ReactNode;
  columns: ColumnDef[];
  fields: FieldDef[];
  empty: Record<string, unknown>;
  load: () => Promise<Record<string, unknown>[]>;
  create: (data: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

export function MasterTable({ config }: { config: MasterConfig }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(config.empty);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await config.load());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => { void load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(config.empty); setShowForm(true); };
  const openEdit = (row: Record<string, unknown>) => { setEditing(row); setForm({ ...config.empty, ...row }); setShowForm(true); };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of config.fields) payload[f.key] = form[f.key];
      if (editing) await config.update(editing.id as string, payload);
      else await config.create(payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: Record<string, unknown>) => {
    const label = (row[config.columns[0].key] as string) || 'this item';
    if (!window.confirm(`Delete “${label}”?`)) return;
    try {
      await config.remove(row.id as string);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return config.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q));
  });

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
        {config.icon} {config.title}
      </h1>
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input className="ef-input w-56" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="ef-btn ef-btn-primary" onClick={openNew}><FilePlus2 className="w-3.5 h-3.5" /> New</button>
        <button className="ef-btn" onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      <div className="ef-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ef-table">
            <thead><tr>
              {config.columns.map((c) => <th key={c.key}>{c.label}</th>)}
              <th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={config.columns.length + 1} className="text-center py-6 text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={config.columns.length + 1} className="text-center py-6 text-slate-400">No records — click “New”.</td></tr>}
              {!loading && filtered.map((row) => (
                <tr key={row.id as string}>
                  {config.columns.map((c) => (
                    <td key={c.key} className="text-slate-700">{c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>
                  ))}
                  <td className="text-right whitespace-nowrap">
                    <button className="ef-btn px-2 py-1 mr-1" onClick={() => openEdit(row)}><Pencil className="w-3.5 h-3.5" /></button>
                    <button className="ef-btn ef-btn-danger px-2 py-1" onClick={() => remove(row)}><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">{filtered.length} record(s)</div>
      </div>

      {showForm && (
        <div className="ef-overlay" onMouseDown={() => setShowForm(false)}>
          <div className="ef-modal max-w-md mt-12" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ef-modal-bar">
              <span>{editing ? `Edit ${config.title}` : `New ${config.title}`}</span>
              <button onClick={() => setShowForm(false)} className="text-white/80 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {config.fields.map((f) => (
                <div key={f.key}>
                  <label className="ef-label">{f.label}{f.required ? ' *' : ''}</label>
                  {f.type === 'select' ? (
                    <select className="ef-select" value={String(form[f.key] ?? '')} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}>
                      {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.type === 'checkbox' ? (
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" className="ef-check" checked={Boolean(form[f.key])} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.checked }))} /> {f.placeholder || 'Yes'}
                    </label>
                  ) : f.type === 'textarea' ? (
                    <textarea className="ef-textarea" rows={3} value={String(form[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                  ) : (
                    <input className="ef-input" value={String(form[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-md">
              <button className="ef-btn ef-btn-primary" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
              <button className="ef-btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
