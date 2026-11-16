/**
 * Demo data for trying the ERP, kept in its own company "DEMO" so it never mixes with real data.
 *
 *   pnpm demo:load    create the DEMO company with masters, PIs, production orders and invoices
 *   pnpm demo:reset   delete the DEMO company and everything in it (real companies are untouched)
 *
 * Everything is created through the same services as the screens (validation, numbering,
 * exact totals, parent balances, audit log), so the demo behaves exactly like real data.
 */
import { add, DOCS, mul, round, type DocKey } from '@rmm/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Tx } from './client.js';
import { adminSql } from './client.js';
import { companies, exchangeRates, masterTables, users } from './schema/index.js';
import { inCompanyTx, type RequestContext } from '../core/context.js';
import { createRecord } from '../modules/masters/masters.service.js';
import { createDocument, draftDocument } from '../modules/documents/documents.service.js';

export const DEMO_CODE = 'DEMO';
type Row = Record<string, unknown>;

// ------------------------------------------------------------------ data
const PACKINGS = [
  { code: 'PP-5', name: '5 KG PP bag', material: 'PP', netWeightKg: '5', tareWeightKg: '0.060', description: '5 KG printed PP bags, packed in 25 KG master bags' },
  { code: 'NW-10', name: '10 KG non-woven bag', material: 'Non-woven', netWeightKg: '10', tareWeightKg: '0.090', description: '10 KG non-woven bags with handle' },
  { code: 'BOPP-20', name: '20 KG BOPP bag', material: 'BOPP', netWeightKg: '20', tareWeightKg: '0.120', description: '20 KG printed BOPP bags' },
  { code: 'NW-40', name: '40 KG non-woven bag', material: 'Non-woven', netWeightKg: '40', tareWeightKg: '0.150', description: '40 KG non-woven bags with inner liner' },
  { code: 'PP-50', name: '50 KG PP bag', material: 'PP', netWeightKg: '50', tareWeightKg: '0.120', description: '50 KG plain PP bags' },
] as const;
type PackCode = (typeof PACKINGS)[number]['code'];

const PRODUCTS = [
  { code: '1121-STM', name: '1121 Steam Basmati Rice', variety: 'Basmati', riceType: 'Steam', grade: 'Premium', hsnCode: '10063020', avgGrainLength: '8.35', brokenPct: '2', moisturePct: '12.5' },
  { code: '1121-GS', name: '1121 Golden Sella Basmati Rice', variety: 'Basmati', riceType: 'Golden Sella', grade: 'Premium', hsnCode: '10063020', avgGrainLength: '8.30', brokenPct: '2', moisturePct: '12.5' },
  { code: '1509-SEL', name: '1509 Sella Basmati Rice', variety: 'Basmati', riceType: 'Sella', grade: 'Standard', hsnCode: '10063020', avgGrainLength: '8.20', brokenPct: '3', moisturePct: '13' },
  { code: 'PUSA-WS', name: 'Pusa Basmati White Sella Rice', variety: 'Basmati', riceType: 'White Sella', grade: 'Standard', hsnCode: '10063020', avgGrainLength: '7.60', brokenPct: '3', moisturePct: '13' },
  { code: 'PR11-SEL', name: 'PR-11 Sella Rice', variety: 'Non-Basmati', riceType: 'Sella', grade: '5% broken', hsnCode: '10063090', avgGrainLength: '6.80', brokenPct: '5', moisturePct: '14' },
  { code: 'SUG-STM', name: 'Sugandha Steam Rice', variety: 'Non-Basmati', riceType: 'Steam', grade: 'Standard', hsnCode: '10063090', avgGrainLength: '7.40', brokenPct: '4', moisturePct: '13.5' },
] as const;
type ProductCode = (typeof PRODUCTS)[number]['code'];

const PAYMENT_TERMS = [
  { code: 'LC-SIGHT', name: 'LC at sight', termType: 'LC at sight', advancePct: '0', creditDays: 0, printText: '100% irrevocable LC at sight' },
  { code: 'ADV30-CAD', name: '30% advance, balance CAD', termType: 'Mixed', advancePct: '30', creditDays: 0, printText: '30% advance by TT, balance 70% cash against documents' },
  { code: 'DP', name: 'DP at sight', termType: 'DP', advancePct: '0', creditDays: 0, printText: 'Documents against payment at sight' },
  { code: 'TT-100', name: '100% advance TT', termType: 'Advance', advancePct: '100', creditDays: 0, printText: '100% advance by TT before shipment' },
] as const;
type TermCode = (typeof PAYMENT_TERMS)[number]['code'];

// [code, name, address, city, country code, currency, payment term, port code, incoterm]
const BUYERS: [string, string, string, string, string, string, TermCode, string, string][] = [
  ['ALNOOR', 'Al Noor Foodstuff Trading LLC', 'Warehouse 14, Al Quoz Industrial Area 3', 'Dubai', 'AE', 'USD', 'LC-SIGHT', 'AEJEA', 'CFR'],
  ['RIYADH', 'Riyadh Rice Company', 'Building 7, 2nd Industrial City', 'Dammam', 'SA', 'USD', 'ADV30-CAD', 'SADMM', 'CFR'],
  ['GULFBAS', 'Gulf Basmati Importers W.L.L.', 'Plot 22, Shuwaikh Industrial Area', 'Kuwait City', 'KW', 'USD', 'DP', 'KWSAA', 'CIF'],
  ['LONGRAIN', 'London Grain Merchants Ltd', 'Unit 5, Thames Gateway Park', 'London', 'GB', 'GBP', 'TT-100', 'GBFXT', 'CIF'],
  ['HUDSON', 'Hudson Fine Foods Inc', '210 Harbor Street', 'Newark', 'US', 'USD', 'DP', 'USNYC', 'FOB'],
  ['COTONOU', 'Cotonou Riz Distribution SARL', 'Zone Portuaire, Lot 18', 'Cotonou', 'BJ', 'USD', 'TT-100', 'BJCOO', 'CFR'],
];

const SUPPLIERS = [
  { code: 'SGRM', name: 'Shree Ganesh Rice Mills', supplierType: 'Miller', city: 'Karnal', state: 'Haryana', phone: '0184-0000001' },
  { code: 'HAM', name: 'Haryana Agro Mills', supplierType: 'Miller', city: 'Kaithal', state: 'Haryana', phone: '01746-000002' },
  { code: 'PPC', name: 'Punjab Packaging Co.', supplierType: 'Packing material', city: 'Ludhiana', state: 'Punjab', phone: '0161-0000003' },
] as const;

const TERMS_TEMPLATES = [
  {
    name: 'Standard PI terms',
    docType: 'Proforma Invoice',
    body: 'Weight and quality as determined at the loading port by an independent surveyor are final.\nShipment within 30 days of receipt of LC / advance.\nPartial shipment and transhipment allowed.\nCrop of the current season; tolerance of 5% more or less on quantity.\nAll bank charges outside India are for the buyer.',
  },
  {
    name: 'Production instructions',
    docType: 'Production Order',
    body: 'Sortex cleaned, free from foreign matter and live insects.\nFumigate every lot before stuffing; keep the fumigation certificate with the lot.\nPrint the brand and lot number on every bag.\nKeep a 2 KG sealed sample of every lot for 6 months.',
  },
  {
    name: 'Invoice declaration',
    docType: 'Commercial Invoice',
    body: 'Goods of Indian origin.\nPayment to be remitted to the bank account mentioned on this invoice.',
  },
] as const;

interface LinePlan {
  product: ProductCode;
  pack: PackCode;
  qty: string;
  rate: string;
}
interface PiPlan {
  buyer: string;
  date: string;
  status: string;
  lines: LinePlan[];
  freight?: string;
  insurance?: string;
  brand: string;
  shipment: string;
  orders?: { date: string; mill: string; status: string; share?: string; invoices?: { date: string; status: string; share?: string; vessel: string; voyage: string }[] }[];
}

/** Six months of a small exporter's business, Sep–Nov of financial year 2026-27. */
const PIS: PiPlan[] = [
  {
    buyer: 'ALNOOR',
    date: '2026-09-08',
    status: 'FULFILLED',
    brand: 'Royal Crown',
    shipment: 'October 2026',
    freight: '7800',
    lines: [
      { product: '1121-GS', pack: 'NW-40', qty: '260', rate: '1185' },
      { product: '1121-STM', pack: 'BOPP-20', qty: '130', rate: '1245' },
    ],
    orders: [{ date: '2026-09-12', mill: 'SGRM', status: 'COMPLETED', invoices: [{ date: '2026-10-09', status: 'PAID', vessel: 'MSC AURORA', voyage: 'IN641W' }] }],
  },
  {
    buyer: 'RIYADH',
    date: '2026-09-21',
    status: 'CONFIRMED',
    brand: 'Desert Pearl',
    shipment: 'October–November 2026',
    lines: [{ product: '1509-SEL', pack: 'NW-40', qty: '520', rate: '1015' }],
    orders: [
      { date: '2026-09-25', mill: 'HAM', status: 'IN_PRODUCTION', share: '0.5', invoices: [{ date: '2026-10-28', status: 'NEGOTIATED', share: '0.6', vessel: 'MAERSK KOLKATA', voyage: '644E' }] },
    ],
  },
  {
    buyer: 'GULFBAS',
    date: '2026-10-05',
    status: 'CONFIRMED',
    brand: 'Gulf Gold',
    shipment: 'November 2026',
    freight: '3200',
    insurance: '210',
    lines: [{ product: 'PUSA-WS', pack: 'NW-10', qty: '104', rate: '1090' }],
    orders: [{ date: '2026-10-08', mill: 'SGRM', status: 'OPEN' }],
  },
  {
    buyer: 'LONGRAIN',
    date: '2026-10-18',
    status: 'CONFIRMED',
    brand: 'Thames Valley',
    shipment: 'December 2026',
    freight: '2100',
    insurance: '95',
    lines: [{ product: '1121-STM', pack: 'PP-5', qty: '52', rate: '1010' }],
  },
  {
    buyer: 'HUDSON',
    date: '2026-11-02',
    status: 'DRAFT',
    brand: 'Hudson Select',
    shipment: 'January 2027',
    lines: [{ product: '1121-GS', pack: 'BOPP-20', qty: '78', rate: '1210' }],
  },
  {
    buyer: 'COTONOU',
    date: '2026-11-10',
    status: 'CONFIRMED',
    brand: 'Riz Soleil',
    shipment: 'December 2026',
    lines: [{ product: 'PR11-SEL', pack: 'PP-50', qty: '1040', rate: '485' }],
    orders: [{ date: '2026-11-12', mill: 'HAM', status: 'OPEN', share: '0.5' }],
  },
  {
    buyer: 'RIYADH',
    date: '2026-08-20',
    status: 'CANCELLED',
    brand: 'Desert Pearl',
    shipment: 'September 2026',
    lines: [{ product: 'SUG-STM', pack: 'NW-40', qty: '260', rate: '720' }],
  },
];

// ------------------------------------------------------------------ helpers
const pick = (fields: { name: string }[], src: Row) => Object.fromEntries(fields.filter((f) => src[f.name] !== undefined).map((f) => [f.name, src[f.name]]));

/** The draft/record shape the screens send: only registry fields (no labels or totals). */
function payload(key: DocKey, src: Row & { lines: Row[]; terms: Row[]; containers?: Row[] }) {
  const def = DOCS[key];
  return {
    ...pick(def.header, src),
    lines: src.lines.map((l) => ({ ...pick(def.lines, l), sourceLineId: l.sourceLineId ?? null })),
    terms: src.terms.map((t) => ({ tcTemplateId: t.tcTemplateId ?? null, content: t.content })),
    containers: (src.containers ?? []).map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !['id', 'companyId', 'documentId', 'position'].includes(k)))),
  };
}

/** Bags and gross weight for a net weight in MT (same rule as the line editor). */
function packed(qty: string, packing: (typeof PACKINGS)[number]) {
  const bags = Math.round((Number(qty) * 1000) / Number(packing.netWeightKg));
  return { noOfBags: bags, grossWtMt: add([qty, mul(mul(String(bags), packing.tareWeightKg, 6), '0.001', 3)], 3) };
}

async function globalIds(tx: Tx, key: string, field = 'code') {
  const t = masterTables[key];
  const rows = await tx.select({ id: t.id, k: t[field] }).from(t).where(isNull(t.deletedAt));
  return new Map(rows.map((r) => [String(r.k), r.id as string]));
}

/** Latest live rate (₹ per unit) if the rates screen has fetched one, else the currency master's default. */
async function rateFor(tx: Tx, code: string): Promise<string> {
  if (code === 'INR') return '1';
  const [live] = await tx.select({ r: exchangeRates.rateToInr }).from(exchangeRates).where(eq(exchangeRates.currencyCode, code)).orderBy(desc(exchangeRates.fetchedAt)).limit(1);
  if (live) return round(live.r, 4);
  const c = masterTables.currencies;
  const [cur] = await tx.select({ r: c.exchangeRate }).from(c).where(eq(c.code, code));
  return round(String(cur?.r ?? '1'), 4);
}

// ------------------------------------------------------------------ load
export async function loadDemo() {
  const [admin] = await inCompanyTx(null, (tx) =>
    tx.select({ id: users.id, username: users.username }).from(users).where(and(eq(users.isSuperAdmin, true), isNull(users.deletedAt))).limit(1),
  );
  if (!admin) throw new Error('No super admin found. Run "pnpm db:seed" first.');
  const existing = await inCompanyTx(null, (tx) => tx.select({ id: companies.id }).from(companies).where(eq(companies.code, DEMO_CODE)));
  if (existing.length) throw new Error('Demo data is already loaded (company DEMO exists). Run "pnpm demo:reset" first to load it again.');

  const ctx: RequestContext = { userId: admin.id, sessionId: 'demo', username: admin.username, isSuperAdmin: true, companyId: null, permissions: new Set(), ip: '127.0.0.1' };

  const company = await inCompanyTx(null, async (tx) => {
    const countries = await globalIds(tx, 'countries');
    const currencies = await globalIds(tx, 'currencies');
    return createRecord(tx, ctx, 'companies', {
      code: DEMO_CODE,
      name: 'Demo Agro Exports',
      legalName: 'Demo Agro Exports Pvt Ltd',
      addressLine1: 'Plot 12, Industrial Area, GT Road',
      city: 'Karnal',
      state: 'Haryana',
      pincode: '132001',
      countryId: countries.get('IN'),
      phone: '0184-0000000',
      email: 'exports@demo.invalid',
      gstin: '06AAACD0000D1Z0',
      iec: '0000000000',
      lutNo: 'AD0600000000DEMO',
      baseCurrencyId: currencies.get('INR'),
      fyStartMonth: 4,
      signatoryName: 'Demo Signatory',
      signatoryDesignation: 'Director',
    });
  });
  const companyId = company.id as string;
  const c: RequestContext = { ...ctx, companyId };

  await inCompanyTx(companyId, async (tx) => {
    const countries = await globalIds(tx, 'countries');
    const currencies = await globalIds(tx, 'currencies');
    const ports = await globalIds(tx, 'ports');
    const units = await globalIds(tx, 'units');
    const lines = await globalIds(tx, 'shippingLines');
    const make = async (key: string, values: Row) => (await createRecord(tx, c, key, values)).id as string;

    // masters
    const term = new Map<string, string>();
    for (const p of PAYMENT_TERMS) term.set(p.code, await make('paymentTerms', p));
    const pack = new Map<string, string>();
    for (const p of PACKINGS) pack.set(p.code, await make('packingTypes', p));
    const product = new Map<string, string>();
    for (const p of PRODUCTS) {
      product.set(p.code, await make('products', { ...p, defaultUnitId: units.get('MT'), cropYear: '2025-26', invoiceDescription: `Indian ${p.name.toLowerCase()}, sortexed, crop 2025-26` }));
    }
    const supplier = new Map<string, string>();
    for (const s of SUPPLIERS) supplier.set(s.code, await make('suppliers', { ...s, address: `Rice mill road, ${s.city}` }));
    await make('serviceProviders', { code: 'SPEEDCHA', name: 'Speedway CHA Services', providerType: 'CHA', address: 'Port road, Mundra', phone: '02838-000001' });
    await make('serviceProviders', { code: 'OCEANFF', name: 'Oceanic Freight Forwarders', providerType: 'Freight forwarder', phone: '022-00000002' });
    await make('bankAccounts', {
      label: 'Demo bank USD',
      bankName: 'Demo Bank Ltd',
      branch: 'Karnal main branch',
      accountName: 'Demo Agro Exports Pvt Ltd',
      accountNumber: '000000000001',
      ifsc: 'DEMO0000001',
      swiftCode: 'DEMOINBB',
      adCode: '0000001',
      currencyId: currencies.get('USD'),
      isDefault: true,
    });
    for (const t of TERMS_TEMPLATES) await make('tcTemplates', { ...t, isDefault: true });
    const buyer = new Map<string, { id: string; currency: string; port: string; incoterm: string; term: string; country: string }>();
    for (const [code, name, address, city, cc, cur, pt, port, inco] of BUYERS) {
      const id = await make('customers', {
        code,
        name,
        address,
        city,
        countryId: countries.get(cc),
        defaultCurrencyId: currencies.get(cur),
        paymentTermId: term.get(pt),
        defaultPortId: ports.get(port),
        incoterm: inco,
        contactPerson: 'Purchase manager',
        email: `purchase@${code.toLowerCase()}.invalid`,
      });
      buyer.set(code, { id, currency: cur, port, incoterm: inco, term: pt, country: cc });
    }

    // documents: PI → production orders → commercial invoices
    const termText = new Map<string, string>(PAYMENT_TERMS.map((p) => [p.code, p.printText]));
    let containerSeq = 1;
    for (const plan of PIS) {
      const b = buyer.get(plan.buyer)!;
      const draft = (await draftDocument(tx, c, 'proformaInvoices')) as Row & { lines: Row[]; terms: Row[] };
      const piLines = plan.lines.map((l) => {
        const p = PRODUCTS.find((x) => x.code === l.product)!;
        const k = PACKINGS.find((x) => x.code === l.pack)!;
        return {
          productId: product.get(l.product),
          packingTypeId: pack.get(l.pack),
          packingText: k.description,
          hsCode: p.hsnCode,
          cropYear: '2025-26',
          quantityMt: l.qty,
          ratePerMt: l.rate,
          brokenPct: p.brokenPct,
          ...packed(l.qty, k),
        };
      });
      const first = PRODUCTS.find((x) => x.code === plan.lines[0].product)!;
      const pi = await createDocument(
        tx,
        c,
        'proformaInvoices',
        payload('proformaInvoices', {
          ...draft,
          documentDate: plan.date,
          status: plan.status,
          buyerId: b.id,
          buyerPoRef: `PO/${plan.buyer}/${plan.date.slice(2, 4)}${plan.date.slice(5, 7)}`,
          poDate: plan.date,
          incoterm: b.incoterm,
          currencyId: currencies.get(b.currency),
          exchangeRate: await rateFor(tx, b.currency),
          paymentTermId: term.get(b.term),
          paymentTerms: termText.get(b.term),
          deliveryTimeline: plan.shipment,
          portOfLoadingId: ports.get('INMUN1'),
          portOfDischargeId: ports.get(b.port),
          destinationCountryId: countries.get(b.country),
          modeOfShipment: 'By sea, FCL containers',
          brand: plan.brand,
          specVariety: `${first.name}, ${first.grade}`,
          specAvgLengthMm: first.avgGrainLength,
          specMoisturePct: first.moisturePct,
          specBrokenPct: first.brokenPct,
          specCropYear: '2025-26',
          freightAmount: plan.freight ?? '0',
          insuranceAmount: plan.insurance ?? '0',
          lines: piLines,
        }),
      );

      for (const order of plan.orders ?? []) {
        const od = (await draftDocument(tx, c, 'productionOrders', (pi as Row).id as string)) as Row & { lines: Row[]; terms: Row[] };
        const share = order.share ?? '1';
        od.lines = od.lines.map((l) => {
          const k = PACKINGS.find((x) => pack.get(x.code) === l.packingTypeId)!;
          const qty = round(mul(String(l.quantityMt), share, 3), 0);
          return { ...l, quantityMt: qty, ...packed(qty, k), brokenBelow: false };
        });
        const po = await createDocument(
          tx,
          c,
          'productionOrders',
          payload('productionOrders', {
            ...od,
            documentDate: order.date,
            status: order.status,
            supplierId: supplier.get(order.mill),
            dispatchSchedule: plan.date.replace(/-\d{2}$/, '-28'),
            millingInstructions: 'Sortex twice; remove chalky and discoloured grains; target broken below specification.',
            packagingInstructions: `Pack in ${PACKINGS.find((x) => pack.get(x.code) === od.lines[0].packingTypeId)?.name}; brand "${plan.brand}" printed both sides.`,
            transport: 'Own trucks to Mundra',
          }),
        );

        for (const inv of order.invoices ?? []) {
          const id = (await draftDocument(tx, c, 'commercialInvoices', (po as Row).id as string)) as Row & { lines: Row[]; terms: Row[] };
          const ishare = inv.share ?? '1';
          const containers: Row[] = [];
          id.lines = id.lines.map((l) => {
            const k = PACKINGS.find((x) => pack.get(x.code) === l.packingTypeId)!;
            // whole 26 MT container loads
            const qty = String(Math.max(26, Math.floor(Number(mul(String(l.quantityMt), ishare, 3)) / 26) * 26));
            const bagsPerContainer = Math.round(26000 / Number(k.netWeightKg));
            for (let n = 0; n < Number(qty) / 26; n++) {
              containers.push({
                containerNumber: `DEMU${String(1000000 + containerSeq++).slice(1)}`,
                sealNumber: `SL${String(800000 + containerSeq)}`,
                containerSize: '20FT',
                totalBags: bagsPerContainer,
                netWeightKg: '26000',
                grossWeightKg: add(['26000', mul(String(bagsPerContainer), k.tareWeightKg, 3)], 3),
              });
            }
            return { ...l, quantityMt: qty, ...packed(qty, k) };
          });
          const freightPerContainer = b.port === 'AEJEA' ? '520' : '640';
          await createDocument(
            tx,
            c,
            'commercialInvoices',
            payload('commercialInvoices', {
              ...id,
              documentDate: inv.date,
              status: inv.status,
              shippingLineId: lines.get(inv.vessel.startsWith('MSC') ? 'MSCU' : 'MAEU'),
              vesselFlightName: inv.vessel,
              voyageNumber: inv.voyage,
              preCarriageBy: 'Road',
              placeOfReceipt: 'Karnal',
              termsOf: id.incoterm as string,
              blNumber: `${inv.vessel.slice(0, 4).replace(/\s/g, '')}${inv.date.replace(/-/g, '').slice(2)}01`,
              blDate: inv.date,
              shippingBillNumber: `${8000000 + containerSeq}`,
              shippingBillDate: inv.date,
              fcl: `${containers.length} × 20FT`,
              marksNumbers: `${plan.brand}\nLOT ${inv.date.replace(/-/g, '').slice(2)}\nMADE IN INDIA`,
              thcCharge: String(containers.length * 95),
              blCharge: '75',
              sealCharge: String(containers.length * 5),
              oceanFreightCharge: String(containers.length * Number(freightPerContainer)),
              insuranceCharge: id.incoterm === 'CIF' ? '180' : '0',
              containers,
            }),
          );
        }
      }
    }
  });
  return { companyId };
}

// ------------------------------------------------------------------ reset
/** Deletes the DEMO company and every row that belongs to it. Real companies are not touched. */
export async function resetDemo(): Promise<boolean> {
  const conn = adminSql();
  try {
    const db = drizzle(conn);
    const [demo] = await db.select({ id: companies.id }).from(companies).where(eq(companies.code, DEMO_CODE));
    if (!demo) return false;
    await db.transaction(async (tx) => {
      // only this transaction: skip FK checks so rows can go in any order (all of them belong to DEMO)
      await tx.execute(sql`set local session_replication_role = replica`);
      const tables = await tx.execute<{ table_name: string }>(
        sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'company_id' and table_name <> 'companies'`,
      );
      for (const { table_name } of tables) await tx.execute(sql`delete from ${sql.identifier(table_name)} where company_id = ${demo.id}`);
      await tx.execute(sql`delete from sharing_policies where source_company_id = ${demo.id} or target_company_id = ${demo.id}`);
      await tx.execute(sql`update users set default_company_id = null where default_company_id = ${demo.id}`);
      await tx.execute(sql`update sessions set active_company_id = null where active_company_id = ${demo.id}`);
      await tx.execute(sql`delete from companies where id = ${demo.id}`);
    });
    return true;
  } finally {
    await conn.end();
  }
}
