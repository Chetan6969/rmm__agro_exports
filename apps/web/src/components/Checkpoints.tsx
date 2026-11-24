/**
 * Shipment checkpoints ("staging") UI: a compact colour-coded path for boards, and the full
 * checkpoint list with planned vs actual dates, owner, proof, and a tick / skip dialog.
 */
import type { CheckpointStatus, CheckpointView, PipelineView } from '@rmm/shared';
import { businessDate } from '@rmm/shared';
import { AlertTriangle, Check, Clock, FileText, Paperclip, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { showError } from '../lib/notify';
import { Modal } from './Modal';
import { Button, ErrorBox } from './ui';

export const STATUS_META: Record<CheckpointStatus, { label: string; dot: string; chip: string }> = {
  done: { label: 'Done', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  skipped: { label: 'Skipped', dot: 'bg-slate-300', chip: 'bg-slate-100 text-slate-500 ring-slate-200' },
  overdue: { label: 'Overdue', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200' },
  due: { label: 'Due soon', dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  upcoming: { label: 'Upcoming', dot: 'bg-slate-200', chip: 'bg-white text-slate-500 ring-slate-200' },
  unplanned: { label: 'No date', dot: 'bg-slate-200', chip: 'bg-white text-slate-400 ring-slate-200' },
};

const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '—');

/** One-line summary: where the lot is, what's next, and what's late. */
export function CheckpointSummary({ p }: { p: PipelineView }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
      <span className="text-slate-500">
        At <b className="text-slate-700">{p.currentStage ?? 'start'}</b>
      </span>
      {p.next && (
        <span className="text-slate-500">
          · Next <b className="text-slate-700">{p.next}</b>
          {p.nextPlannedDate && ` by ${fmt(p.nextPlannedDate)}`}
        </span>
      )}
      {p.overdue > 0 && <span className="rounded bg-red-50 px-1.5 py-px font-semibold text-red-700 ring-1 ring-red-200 ring-inset">{p.overdue} overdue</span>}
      {p.dueSoon > 0 && <span className="rounded bg-amber-50 px-1.5 py-px font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">{p.dueSoon} due soon</span>}
      {p.steps.some((s) => s.outOfOrder) && <span className="rounded bg-violet-50 px-1.5 py-px font-medium text-violet-700 ring-1 ring-violet-200 ring-inset">out of order</span>}
    </div>
  );
}

/** Compact path: one segment per checkpoint, coloured by status. */
export function CheckpointPath({ p }: { p: PipelineView }) {
  return (
    <div className="flex gap-0.5" aria-label={`${p.done} of ${p.total} checkpoints closed`}>
      {p.steps.map((s) => (
        <span
          key={s.key}
          title={`${s.label} · ${STATUS_META[s.status].label}${s.plannedDate ? ` · plan ${fmt(s.plannedDate)}` : ''}${s.date ? ` · actual ${fmt(s.date)}` : ''}${s.outOfOrder ? ' · out of order' : ''}`}
          className={`h-1.5 flex-1 rounded-full ${STATUS_META[s.status].dot} ${s.key === p.nextKey ? 'ring-2 ring-indigo-300 ring-offset-1' : ''}`}
        />
      ))}
    </div>
  );
}

/** Full checkpoint list of a lot, with planned vs actual and the tick / skip dialog. */
export function CheckpointList({ shipmentId, p, readOnly, onChanged }: { shipmentId: string; p: PipelineView; readOnly: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState<CheckpointView | null>(null);
  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">
          Checkpoints · {p.done}/{p.total}
        </span>
        <CheckpointSummary p={p} />
      </div>
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${p.percent}%` }} />
      </div>
      <ol className="divide-y divide-slate-100 rounded-md border border-slate-100 bg-white">
        {p.steps.map((s, i) => {
          const meta = STATUS_META[s.status];
          const clickable = !readOnly && !s.doc;
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => setOpen(s)}
                className={`grid w-full grid-cols-[20px_1fr_auto] items-start gap-2 px-2.5 py-1.5 text-left text-[12.5px] sm:grid-cols-[20px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] ${clickable ? 'hover:bg-slate-50' : 'cursor-default'} ${s.key === p.nextKey ? 'bg-indigo-50/40' : ''}`}
              >
                <span className={`mt-0.5 flex size-4 items-center justify-center rounded-full text-[9px] text-white ${meta.dot}`}>
                  {s.status === 'done' ? <Check className="size-3" /> : s.status === 'skipped' ? <SkipForward className="size-2.5" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{s.label}</span>
                  {s.doc && <FileText className="ml-1 inline size-3 text-slate-400" aria-label="closes from its document" />}
                  {s.requiresFile && !s.doc && <Paperclip className="ml-1 inline size-3 text-slate-400" aria-label="proof required" />}
                  {s.outOfOrder && <AlertTriangle className="ml-1 inline size-3 text-violet-600" aria-label="done out of order" />}
                  <span className="block truncate text-[11.5px] text-slate-400">{[s.owner, s.evidence].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="hidden text-[11.5px] text-slate-500 sm:block">
                  <Clock className="mr-0.5 inline size-3" />
                  Plan {fmt(s.plannedDate)}
                </span>
                <span className="hidden text-[11.5px] sm:block">
                  {s.done ? (
                    <span className={s.lateDays && s.lateDays > 0 ? 'text-red-600' : 'text-emerald-700'}>
                      {fmt(s.date)}
                      {s.lateDays != null && s.lateDays !== 0 && ` (${s.lateDays > 0 ? `${s.lateDays}d late` : `${-s.lateDays}d early`})`}
                    </span>
                  ) : s.skipped ? (
                    <span className="text-slate-400" title={s.skipReason ?? ''}>Skipped: {s.skipReason}</span>
                  ) : s.status === 'overdue' ? (
                    <span className="font-medium text-red-600">{s.lateDays}d overdue</span>
                  ) : null}
                  {s.doneByName && <span className="block text-[10.5px] text-slate-400">by {s.doneByName}</span>}
                </span>
                <span className={`rounded px-1.5 py-px text-[10.5px] font-medium ring-1 ring-inset ${meta.chip}`}>{meta.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {open && <CheckpointDialog shipmentId={shipmentId} step={open} onClose={() => setOpen(null)} onSaved={() => (setOpen(null), onChanged())} />}
    </div>
  );
}

function CheckpointDialog({ shipmentId, step, onClose, onSaved }: { shipmentId: string; step: CheckpointView; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'done' | 'skip'>(step.skipped ? 'skip' : 'done');
  const [date, setDate] = useState(step.date ?? businessDate());
  const [note, setNote] = useState(step.note ?? '');
  const [reason, setReason] = useState(step.skipReason ?? '');
  const [fileId, setFileId] = useState<string | null>(step.fileId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/shipments/${shipmentId}/stage`, { stageKey: step.key, ...body });
      onSaved();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      setFileId((await api.upload<{ id: string }>('/files', f)).id);
    } catch (e) {
      showError(e);
    }
  };

  return (
    <Modal
      open
      title={step.label}
      onClose={onClose}
      footer={
        <>
          {(step.done || step.skipped) && (
            <Button className="mr-auto" onClick={() => send({ done: false, skipped: false })} loading={busy}>
              Reopen
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          {mode === 'done' ? (
            <Button variant="primary" loading={busy} onClick={() => send({ done: true, doneDate: date, note: note || null, fileId })}>
              Mark done
            </Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={() => send({ done: false, skipped: true, skipReason: reason, note: note || null })}>
              Skip checkpoint
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="rounded-md bg-slate-50 px-3 py-2 text-slate-600">
          {step.evidence && <div>What closes it: <b>{step.evidence}</b></div>}
          <div className="text-[12px] text-slate-500">
            {step.owner && <>Owner: {step.owner} · </>}Planned by {fmt(step.plannedDate)}
            {step.requiresFile && ' · proof file required'}
          </div>
        </div>
        <div className="flex rounded border border-slate-300 text-[12.5px]" role="radiogroup">
          {(['done', 'skip'] as const).map((m, i) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`flex-1 py-1 ${mode === m ? 'bg-slate-800 text-white' : 'text-slate-600'} ${i ? 'border-l border-slate-300' : ''}`}>
              {m === 'done' ? 'Done' : 'Not needed for this lot'}
            </button>
          ))}
        </div>
        {mode === 'done' ? (
          <>
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Done on</span>
              <input type="date" className="field-input" value={date} max={businessDate()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div>
              <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Proof {step.requiresFile ? <span className="text-red-500">*</span> : '(optional)'}</span>
              <div className="flex items-center gap-2">
                {fileId ? (
                  <a href={`/api/files/${fileId}`} target="_blank" rel="noopener" className="text-brand-700 hover:underline">
                    <Paperclip className="mr-0.5 inline size-3.5" />
                    Attached file
                  </a>
                ) : (
                  <span className="text-slate-400">No file</span>
                )}
                <label className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-0.5 text-[12.5px] hover:bg-slate-50">
                  {fileId ? 'Replace…' : 'Attach photo / PDF…'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                </label>
              </div>
            </div>
          </>
        ) : (
          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Why is it not needed? <span className="text-red-500">*</span></span>
            <input className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Buyer waived COC for this lot" />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Note</span>
          <textarea className="field-input resize-y" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
