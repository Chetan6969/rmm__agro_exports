/**
 * Shipment pipeline templates. A shipment's market (Gulf / EU) picks the ordered list of steps it
 * goes through, from PI to payment. Steps with a `doc` are completed automatically when that document
 * is linked to the shipment (PI is always done); the rest are ticked manually with a date.
 */
export type StageDoc = 'pi' | 'productionOrder' | 'oceanBill' | 'commercialInvoice';

export interface PipelineStep {
  key: string;
  label: string;
  /** When set, the step auto-completes from the shipment's linked document (not manually ticked). */
  doc?: StageDoc;
}

const COMMON_HEAD: PipelineStep[] = [
  { key: 'pi', label: 'PI', doc: 'pi' },
  { key: 'packing_order', label: 'Packing order' },
  { key: 'production', label: 'Production order', doc: 'productionOrder' },
  { key: 'apeda', label: 'APEDA' },
];
const COMMON_TAIL: PipelineStep[] = [
  { key: 'stuffing', label: 'Stuffing' },
  { key: 'booking', label: 'Booking' },
  { key: 'routing', label: 'Routing' },
  { key: 'on_board', label: 'On board' },
  { key: 'liner_payment', label: 'Liner payment' },
  { key: 'bl', label: 'BL', doc: 'oceanBill' },
  { key: 'invoice', label: 'Packing list & invoice', doc: 'commercialInvoice' },
  { key: 'docs_customs', label: 'Docs to customs' },
  { key: 'payment_due', label: 'Payment due' },
];

export const PIPELINE_TEMPLATES: Record<'GULF' | 'EU', PipelineStep[]> = {
  GULF: [...COMMON_HEAD, { key: 'coc', label: 'COC' }, { key: 'bl_draft', label: 'BL draft' }, ...COMMON_TAIL],
  EU: [...COMMON_HEAD, { key: 'eia', label: 'Reports — EIA' }, { key: 'third_party', label: 'Reports — third party' }, ...COMMON_TAIL],
};

export const pipelineSteps = (market: string): PipelineStep[] => PIPELINE_TEMPLATES[market === 'EU' ? 'EU' : 'GULF'];

/** Manual (non-document) step keys for a market — the ones stored in shipment_stages. */
export const manualStepKeys = (market: string): string[] => pipelineSteps(market).filter((s) => !s.doc).map((s) => s.key);
