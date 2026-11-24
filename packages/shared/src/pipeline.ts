/**
 * Shipment stage tracking ("staging"): every lot goes through an ordered path of checkpoints from
 * PI to payment. A company can edit the path per market (Administration → Shipment checkpoints);
 * these defaults apply until it does.
 *
 * Each checkpoint carries what *should* happen: when (days before the lot's target ship date),
 * who is responsible, and what proof closes it. Document checkpoints close themselves when the
 * document is linked to the lot; the rest are ticked with a date (and a file when proof is required),
 * or skipped with a reason.
 */
import { z } from 'zod';

export type StageDoc = 'pi' | 'productionOrder' | 'oceanBill' | 'commercialInvoice';
export const STAGE_DOCS: { value: StageDoc; label: string }[] = [
  { value: 'pi', label: 'Proforma invoice' },
  { value: 'productionOrder', label: 'Production order' },
  { value: 'oceanBill', label: 'Bill of lading' },
  { value: 'commercialInvoice', label: 'Commercial invoice' },
];

export const STAGE_OWNERS = ['Sales', 'Production', 'Documentation', 'Logistics', 'Accounts', 'Quality'] as const;
export const MARKETS = ['GULF', 'EU'] as const;
export type Market = (typeof MARKETS)[number];

export interface PipelineStep {
  key: string;
  label: string;
  /** When set, the step completes automatically from the lot's linked document. */
  doc?: StageDoc | null;
  /** Planned date = target ship date − this many days (negative = after shipping). */
  daysBeforeShip?: number | null;
  owner?: string | null;
  /** What closes this checkpoint, shown to the person ticking it. */
  evidence?: string | null;
  /** A file (photo / scan) must be attached when ticking. */
  requiresFile?: boolean;
}

const s = (key: string, label: string, daysBeforeShip: number | null, owner: string, evidence: string, extra: Partial<PipelineStep> = {}): PipelineStep => ({
  key,
  label,
  daysBeforeShip,
  owner,
  evidence,
  requiresFile: false,
  doc: null,
  ...extra,
});

const COMMON_HEAD: PipelineStep[] = [
  s('pi', 'PI', 45, 'Sales', 'Proforma invoice confirmed by the buyer', { doc: 'pi' }),
  s('packing_order', 'Packing order', 35, 'Production', 'Bags and labels ordered as per PI'),
  s('production', 'Production order', 30, 'Production', 'Production order issued to the mill', { doc: 'productionOrder' }),
  s('apeda', 'APEDA', 21, 'Documentation', 'APEDA registration / RCMC valid for this contract', { requiresFile: true }),
];
const COMMON_TAIL: PipelineStep[] = [
  s('stuffing', 'Stuffing', 7, 'Logistics', 'Containers stuffed and sealed; seal numbers noted'),
  s('booking', 'Booking', 10, 'Logistics', 'Shipping line booking confirmation', { requiresFile: true }),
  s('routing', 'Routing', 5, 'Logistics', 'Routing / cut-off received from the line'),
  s('on_board', 'On board', 0, 'Logistics', 'Container loaded on the vessel'),
  s('liner_payment', 'Liner payment', -2, 'Accounts', 'Freight / liner charges paid'),
  s('bl', 'BL', -3, 'Documentation', 'Bill of lading issued', { doc: 'oceanBill' }),
  s('invoice', 'Packing list & invoice', -3, 'Documentation', 'Commercial invoice and packing list issued', { doc: 'commercialInvoice' }),
  s('docs_customs', 'Docs to customs', -5, 'Documentation', 'Shipping bill filed with customs'),
  s('payment_due', 'Payment due', -30, 'Accounts', 'Buyer payment received in full'),
];

export const PIPELINE_TEMPLATES: Record<Market, PipelineStep[]> = {
  GULF: [
    ...COMMON_HEAD,
    s('coc', 'COC', 14, 'Quality', 'Certificate of conformity issued', { requiresFile: true }),
    s('bl_draft', 'BL draft', 3, 'Documentation', 'BL draft checked with the buyer'),
    ...COMMON_TAIL,
  ],
  EU: [
    ...COMMON_HEAD,
    s('eia', 'Reports — EIA', 14, 'Quality', 'EIA inspection report', { requiresFile: true }),
    s('third_party', 'Reports — third party', 12, 'Quality', 'Third-party lab / inspection report', { requiresFile: true }),
    ...COMMON_TAIL,
  ],
};

export const pipelineSteps = (market: string): PipelineStep[] => PIPELINE_TEMPLATES[market === 'EU' ? 'EU' : 'GULF'];

/** Manual (non-document) step keys for a market — the ones stored in shipment_stages. */
export const manualStepKeys = (market: string): string[] => pipelineSteps(market).filter((x) => !x.doc).map((x) => x.key);

/** Validation for a company's own checkpoint list. */
export const pipelineTemplateSchema = z
  .array(
    z.object({
      key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,40}$/, 'Key: lowercase letters, digits and _'),
      label: z.string().trim().min(1, 'Name the checkpoint').max(80),
      doc: z.enum(['pi', 'productionOrder', 'oceanBill', 'commercialInvoice']).nullable().optional(),
      daysBeforeShip: z.number().int().min(-365).max(365).nullable().optional(),
      owner: z.string().trim().max(40).nullable().optional(),
      evidence: z.string().trim().max(300).nullable().optional(),
      requiresFile: z.boolean().optional(),
    }),
  )
  .min(1, 'Keep at least one checkpoint')
  .max(60)
  .superRefine((steps, ctx) => {
    const seen = new Set<string>();
    steps.forEach((st, i) => {
      if (seen.has(st.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: `Key "${st.key}" is used twice` });
      seen.add(st.key);
    });
    const docs = steps.filter((st) => st.doc).map((st) => st.doc);
    if (new Set(docs).size !== docs.length) ctx.addIssue({ code: 'custom', path: [], message: 'Each document can close only one checkpoint' });
  });

// ------------------------------------------------------------------ status of a lot's checkpoints
export type CheckpointStatus = 'done' | 'skipped' | 'overdue' | 'due' | 'upcoming' | 'unplanned';

export interface StageRecord {
  done: boolean;
  doneDate?: string | null;
  note?: string | null;
  skipped?: boolean;
  skipReason?: string | null;
  fileId?: string | null;
  doneBy?: string | null;
  doneByName?: string | null;
}

export interface CheckpointView {
  key: string;
  label: string;
  doc: StageDoc | null;
  owner: string | null;
  evidence: string | null;
  requiresFile: boolean;
  /** Date it should be done by (from the target ship date), if the lot has one. */
  plannedDate: string | null;
  done: boolean;
  /** Actual date (ticked date, or the linked document's date). */
  date: string | null;
  note: string | null;
  skipped: boolean;
  skipReason: string | null;
  fileId: string | null;
  doneByName: string | null;
  status: CheckpointStatus;
  /** Days late (overdue: until today; done: actual vs planned). Negative = early. */
  lateDays: number | null;
  /** Done while an earlier checkpoint is still open. */
  outOfOrder: boolean;
}

export interface PipelineView {
  steps: CheckpointView[];
  total: number;
  done: number;
  percent: number;
  /** Next open checkpoint (label), null when everything is closed. */
  next: string | null;
  nextKey: string | null;
  nextPlannedDate: string | null;
  overdue: number;
  dueSoon: number;
  /** The checkpoint the lot is at: the last closed one. */
  currentStage: string | null;
}

/** Days within which an open checkpoint counts as "due soon". */
export const DUE_SOON_DAYS = 7;

const dayMs = 86_400_000;
const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / dayMs);

/**
 * Status of every checkpoint of one lot.
 *  doneByDoc: document checkpoints closed by a linked document, with that document's date.
 *  records:   manual ticks / skips by step key.
 *  today:     YYYY-MM-DD in the business time zone.
 */
export function evaluatePipeline(
  steps: PipelineStep[],
  input: { targetShipDate: string | null; doneByDoc: Partial<Record<StageDoc, string | null>>; records: Record<string, StageRecord>; today: string },
): PipelineView {
  const views: CheckpointView[] = steps.map((st) => {
    const rec = input.records[st.key];
    const byDoc = st.doc ? st.doc in input.doneByDoc : false;
    const done = st.doc ? byDoc : !!rec?.done;
    const skipped = !done && !!rec?.skipped;
    const plannedDate = input.targetShipDate && st.daysBeforeShip != null ? addDays(input.targetShipDate, -st.daysBeforeShip) : null;
    const date = st.doc ? (input.doneByDoc[st.doc] ?? null) : (rec?.doneDate ?? null);
    let status: CheckpointStatus;
    let lateDays: number | null = null;
    if (done) {
      status = 'done';
      if (plannedDate && date) lateDays = diffDays(date, plannedDate);
    } else if (skipped) status = 'skipped';
    else if (!plannedDate) status = 'unplanned';
    else {
      const left = diffDays(plannedDate, input.today);
      if (left < 0) {
        status = 'overdue';
        lateDays = -left;
      } else status = left <= DUE_SOON_DAYS ? 'due' : 'upcoming';
    }
    return {
      key: st.key,
      label: st.label,
      doc: st.doc ?? null,
      owner: st.owner ?? null,
      evidence: st.evidence ?? null,
      requiresFile: !!st.requiresFile,
      plannedDate,
      done,
      date,
      note: rec?.note ?? null,
      skipped,
      skipReason: skipped ? (rec?.skipReason ?? null) : null,
      fileId: rec?.fileId ?? null,
      doneByName: done && !st.doc ? (rec?.doneByName ?? null) : null,
      status,
      lateDays,
      outOfOrder: false,
    };
  });
  // a checkpoint closed while an earlier one is still open happened out of order
  views.forEach((v, i) => {
    if (v.done) v.outOfOrder = views.slice(0, i).some((p) => !p.done && !p.skipped);
  });
  const closed = views.filter((v) => v.done || v.skipped).length;
  const nextOpen = views.find((v) => !v.done && !v.skipped) ?? null;
  const lastClosed = [...views].reverse().find((v) => v.done) ?? null;
  return {
    steps: views,
    total: views.length,
    done: closed,
    percent: views.length ? Math.round((closed / views.length) * 100) : 0,
    next: nextOpen?.label ?? null,
    nextKey: nextOpen?.key ?? null,
    nextPlannedDate: nextOpen?.plannedDate ?? null,
    overdue: views.filter((v) => v.status === 'overdue').length,
    dueSoon: views.filter((v) => v.status === 'due').length,
    currentStage: lastClosed?.label ?? null,
  };
}
