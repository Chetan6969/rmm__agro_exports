/**
 * Automatic shipment planning (the "Planning" sheet, done by the ERP):
 *  order lines (pack size × destination port × quantity × dispatch date)
 *    → lots per dispatch period (month, P1 = 1–15 / P2 = 16–end), filled port by port
 *    → bags and 20' containers per lot line
 *    → packaging material to buy (outer bags, inner packs, tags, strips, seals) with the free %
 * and the document checklist every lot needs before it is complete. Pure functions.
 */

export interface PlanLineInput {
  /** Order line it comes from. */
  lineId: string | null;
  label: string;
  packingTypeId: string | null;
  packingName: string | null;
  /** Kilograms in one outer bag (e.g. 40 for "4 × 10 kg"). */
  packKg: number;
  /** Inner packs per outer bag (4 for "4 × 10 kg", 1 for a plain 40 kg bag). */
  innerPacks: number;
  /** MT one 20' container takes in this packing (from the packing master; 0 = unknown). */
  containerLoadMt: number;
  portId: string | null;
  portName: string | null;
  quantityMt: number;
  dispatchBy: string | null;
}

export interface PlanOptions {
  /** Most containers in one lot (one booking / one invoice). */
  maxContainersPerLot: number;
  /** Used when the packing master has no container load. */
  defaultContainerLoadMt: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { maxContainersPerLot: 26, defaultContainerLoadMt: 23 };

export interface PlannedLotLine extends Omit<PlanLineInput, 'quantityMt'> {
  quantityMt: number;
  bags: number;
  containers: number;
}

export interface PlannedLot {
  lotNo: number;
  /** "Dec 2026 · P1" — or "No date" when the order gives none. */
  period: string;
  /** Last day of the dispatch window (target ship date). */
  targetShipDate: string | null;
  lines: PlannedLotLine[];
  quantityMt: number;
  bags: number;
  containers: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dispatch window of a date: P1 = 1st–15th, P2 = 16th–end of month. */
export function dispatchWindow(date: string | null): { key: string; label: string; end: string | null } {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { key: '9999-99-9', label: 'No date', end: null };
  const [y, m, d] = date.split('-').map(Number);
  const p = d <= 15 ? 1 : 2;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { key: `${y}-${String(m).padStart(2, '0')}-${p}`, label: `${MONTH[m - 1]} ${y} · P${p}`, end: `${y}-${String(m).padStart(2, '0')}-${p === 1 ? '15' : String(last)}` };
}

/** Split order lines into lots: one dispatch window after another, ports kept together, at most N containers a lot. */
export function planLots(input: PlanLineInput[], opts: PlanOptions = DEFAULT_PLAN_OPTIONS): PlannedLot[] {
  const max = Math.max(1, Math.floor(opts.maxContainersPerLot));
  const groups = new Map<string, { label: string; end: string | null; lines: PlanLineInput[] }>();
  for (const l of input.filter((x) => x.quantityMt > 0)) {
    const w = dispatchWindow(l.dispatchBy);
    const g = groups.get(w.key) ?? { label: w.label, end: w.end, lines: [] };
    g.lines.push(l);
    groups.set(w.key, g);
  }
  const lots: PlannedLot[] = [];
  for (const [, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...g.lines].sort((a, b) => (a.portName ?? '').localeCompare(b.portName ?? '') || b.packKg - a.packKg);
    const state: { lot: PlannedLot | null } = { lot: null };
    const open = (): PlannedLot => {
      const lot: PlannedLot = { lotNo: lots.length + 1, period: g.label, targetShipDate: g.end, lines: [], quantityMt: 0, bags: 0, containers: 0 };
      lots.push(lot);
      state.lot = lot;
      return lot;
    };
    for (const l of sorted) {
      const load = l.containerLoadMt > 0 ? l.containerLoadMt : opts.defaultContainerLoadMt;
      let left = l.quantityMt;
      while (left > 0.0005) {
        const need = Math.ceil(r3(left / load) - 1e-9);
        // keep a port line in one lot when it fits a fresh lot, instead of splitting it across two
        const fits = state.lot && state.lot.containers < max && (need <= max - state.lot.containers || need > max);
        const cur: PlannedLot = fits ? state.lot! : open();
        const room = max - cur.containers;
        const take = Math.min(room, need);
        const qty = take >= need ? left : r3(take * load);
        const bags = l.packKg > 0 ? Math.round((qty * 1000) / l.packKg) : 0;
        cur.lines.push({ ...l, quantityMt: r3(qty), bags, containers: take });
        cur.quantityMt = r3(cur.quantityMt + qty);
        cur.bags += bags;
        cur.containers += take;
        left = r3(left - qty);
      }
    }
  }
  return lots;
}

// ------------------------------------------------------------------ packaging

export const PACKAGING_COMPONENTS = [
  { key: 'outer', label: 'Outer bag', perBag: (_inner: number) => 1 },
  { key: 'inner', label: 'Inner pack', perBag: (inner: number) => (inner > 1 ? inner : 0) },
  { key: 'tag', label: 'Tag', perBag: () => 1 },
  { key: 'strip', label: 'Strip', perBag: () => 1 },
  { key: 'seal', label: 'Seal', perBag: () => 1 },
] as const;
export type PackagingComponent = (typeof PACKAGING_COMPONENTS)[number]['key'];

export interface PackagingNeed {
  component: PackagingComponent;
  label: string;
  packingTypeId: string | null;
  packingName: string;
  bags: number;
  perBag: number;
  freePct: number;
  /** Bags × per bag × (1 + free %), rounded up. */
  quantity: number;
}

/** What to buy for the planned bags, per packing and component. Free % covers the spare bags shipped free. */
export function packagingNeeds(lines: { packingTypeId: string | null; packingName: string | null; bags: number; innerPacks: number }[], freePct = 2, components: PackagingComponent[] = ['outer', 'inner', 'tag', 'strip', 'seal']): PackagingNeed[] {
  const byPack = new Map<string, { packingTypeId: string | null; packingName: string; bags: number; innerPacks: number }>();
  for (const l of lines) {
    const key = l.packingTypeId ?? l.packingName ?? '?';
    const cur = byPack.get(key) ?? { packingTypeId: l.packingTypeId, packingName: l.packingName ?? 'Packing', bags: 0, innerPacks: l.innerPacks };
    cur.bags += l.bags;
    byPack.set(key, cur);
  }
  const out: PackagingNeed[] = [];
  for (const p of byPack.values()) {
    for (const c of PACKAGING_COMPONENTS.filter((x) => components.includes(x.key))) {
      const perBag = c.perBag(p.innerPacks);
      if (!perBag) continue;
      out.push({ component: c.key, label: c.label, packingTypeId: p.packingTypeId, packingName: p.packingName, bags: p.bags, perBag, freePct, quantity: Math.ceil(p.bags * perBag * (1 + freePct / 100) - 1e-9) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ buying side

/** What a purchase order or purchase invoice is for. */
export const PURCHASE_CATEGORY_KEYS = ['PACKAGING', 'PADDY_RICE', 'SERVICE', 'OTHER'] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORY_KEYS)[number];
export const PURCHASE_CATEGORIES: Record<PurchaseCategory, string> = { PACKAGING: 'Packaging', PADDY_RICE: 'Paddy / rice', SERVICE: 'Service (CHA, transport, testing…)', OTHER: 'Other' };

// ------------------------------------------------------------------ lot document checklist

/** Documents every lot needs, by market (keys are intake document kinds). */
export const LOT_DOC_CHECKLIST: Record<string, string[]> = {
  GULF: ['export_invoice', 'packing_list', 'booking', 'shipping_bill', 'bill_of_lading', 'certificate_of_origin', 'phytosanitary', 'fumigation', 'health_certificate', 'test_report', 'bill_of_exchange'],
  EU: ['export_invoice', 'packing_list', 'booking', 'eia_intimation', 'traceability', 'test_report', 'apeda', 'shipping_bill', 'bill_of_lading', 'certificate_of_origin', 'phytosanitary'],
};
export const checklistFor = (market: string | null | undefined) => LOT_DOC_CHECKLIST[market === 'EU' ? 'EU' : 'GULF'];

export const BL_STATUSES = ['PENDING', 'DRAFT', 'RECEIVED', 'RELEASED'] as const;
export const LOT_DOC_STATUSES = ['RECEIVED', 'NOT_NEEDED'] as const;
