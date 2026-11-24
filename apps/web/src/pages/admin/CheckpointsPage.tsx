import { MARKETS, STAGE_DOCS, STAGE_OWNERS, type Market, type PipelineStep } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/Modal';
import { Badge, Button, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';

interface TemplateInfo {
  steps: PipelineStep[];
  custom: boolean;
  version: number;
  defaults: PipelineStep[];
}
type Templates = Record<Market, TemplateInfo>;
type Draft = PipelineStep & { _k: string };

let seq = 0;
const k = () => `s${++seq}`;
const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 's_$1')
    .slice(0, 40) || 'step';

/** Administration → Shipment checkpoints: the path each lot goes through, per market. */
export function CheckpointsPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const canEdit = can('admin.pipeline', 'edit');
  const [market, setMarket] = useState<Market>('GULF');
  const q = useQuery({ queryKey: ['pipeline-templates'], queryFn: () => api.get<Templates>('/pipeline/templates') });
  const [rows, setRows] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const t = q.data?.[market];

  useEffect(() => {
    if (t) {
      setRows(t.steps.map((s) => ({ ...s, _k: k() })));
      setDirty(false);
      setErr(null);
    }
  }, [t]);

  const set = (i: number, patch: Partial<PipelineStep>) => {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const move = (i: number, d: -1 | 1) => {
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const n = [...r];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const steps = rows.map(({ _k, ...s }) => ({ ...s, key: s.key || slug(s.label), daysBeforeShip: s.daysBeforeShip ?? null }));
      await api.put(`/pipeline/templates/${market}`, { steps, version: t?.version });
      await qc.invalidateQueries({ queryKey: ['pipeline-templates'] });
      qc.invalidateQueries({ queryKey: ['shipments'] });
      qc.invalidateQueries({ queryKey: ['plan'] });
      toast.success(`${market === 'EU' ? 'EU' : 'Gulf'} checkpoints saved`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    await api.del(`/pipeline/templates/${market}`);
    await qc.invalidateQueries({ queryKey: ['pipeline-templates'] });
    qc.invalidateQueries({ queryKey: ['shipments'] });
    toast.success('Back to the standard checkpoints');
  };

  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const fieldErr = err instanceof ApiError ? err.fields : {};
  const ro = !canEdit;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Shipment checkpoints"
        subtitle="The path every lot goes through, when each step should happen, who owns it and what proof closes it"
        actions={
          canEdit && (
            <>
              {t?.custom && (
                <Button icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirmReset(true)}>
                  Use standard list
                </Button>
              )}
              <Button variant="primary" icon={<Save className="size-3.5" />} loading={busy} disabled={!dirty} onClick={save}>
                Save
              </Button>
            </>
          )
        }
      />
      <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded border border-slate-300 bg-white text-[12.5px]" role="radiogroup" aria-label="Market">
            {MARKETS.map((m, i) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={market === m}
                onClick={() => !dirty && setMarket(m)}
                title={dirty ? 'Save or discard your changes first' : undefined}
                className={`px-3 py-1 ${market === m ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'} ${i ? 'border-l border-slate-300' : ''}`}
              >
                {m === 'EU' ? 'EU' : 'Gulf'}
              </button>
            ))}
          </div>
          <Badge tone={t?.custom ? 'blue' : 'slate'}>{t?.custom ? 'Your own list' : 'Standard list'}</Badge>
          {ro && <Badge>Read only</Badge>}
          <span className="text-[12px] text-slate-500">Days before ship: planned date = lot’s target ship date minus these days (negative = after shipping).</span>
        </div>
        {err != null && <ErrorBox error={err} />}
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-xs">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11.5px] text-slate-500 uppercase">
                <th className="w-8 px-2 py-2">#</th>
                <th className="px-2 py-2">Checkpoint</th>
                <th className="w-24 px-2 py-2">Days before ship</th>
                <th className="w-36 px-2 py-2">Owner</th>
                <th className="w-44 px-2 py-2">Closes from document</th>
                <th className="px-2 py-2">Proof / what closes it</th>
                <th className="w-16 px-2 py-2 text-center">File</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r._k} className="border-b border-slate-100 align-top">
                  <td className="px-2 py-1.5 text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="px-2 py-1">
                    <input className="field-input" disabled={ro} value={r.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Checkpoint name" />
                    {fieldErr[`${i}.key`] && <div className="text-[11.5px] text-red-600">{fieldErr[`${i}.key`]}</div>}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="field-input text-right tabular-nums"
                      disabled={ro}
                      inputMode="numeric"
                      value={r.daysBeforeShip ?? ''}
                      onChange={(e) => set(i, { daysBeforeShip: e.target.value === '' ? null : Number(e.target.value.replace(/[^-\d]/g, '')) })}
                      aria-label="Days before ship"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select className="field-input" disabled={ro} value={r.owner ?? ''} onChange={(e) => set(i, { owner: e.target.value || null })} aria-label="Owner">
                      <option value="">—</option>
                      {STAGE_OWNERS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select className="field-input" disabled={ro} value={r.doc ?? ''} onChange={(e) => set(i, { doc: (e.target.value || null) as PipelineStep['doc'] })} aria-label="Closes from document">
                      <option value="">Manual tick</option>
                      {STAGE_DOCS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input className="field-input" disabled={ro} value={r.evidence ?? ''} onChange={(e) => set(i, { evidence: e.target.value || null })} aria-label="Proof" />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" className="size-4 accent-brand-700" disabled={ro || !!r.doc} checked={!!r.requiresFile && !r.doc} onChange={(e) => set(i, { requiresFile: e.target.checked })} aria-label="Proof file required" />
                  </td>
                  <td className="px-1 py-1 text-right whitespace-nowrap">
                    {!ro && (
                      <>
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></button>
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></button>
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => (setRows((x) => x.filter((_, j) => j !== i)), setDirty(true))} aria-label="Remove"><Trash2 className="size-3.5" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ro && (
          <Button icon={<Plus className="size-3.5" />} onClick={() => (setRows((x) => [...x, { _k: k(), key: '', label: 'New checkpoint', daysBeforeShip: null, owner: null, evidence: null, requiresFile: false, doc: null }]), setDirty(true))}>
            Add checkpoint
          </Button>
        )}
        <p className="text-[12px] text-slate-500">Changes apply to every lot of this market straight away; ticks already recorded are kept (a removed checkpoint’s tick stays in the audit log).</p>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Use the standard checkpoint list?"
        message="Your own list for this market is removed and the built-in one applies again."
        confirmLabel="Use standard list"
        onClose={() => setConfirmReset(false)}
        onConfirm={reset}
      />
    </div>
  );
}
