/**
 * Loads one real order into a real company "RMM Agro Exports" so the app has live data to work with:
 * Mayar Foods 10th order (buyer PO 4200001676, LC IM2620133003), shipped in four lots under
 * invoices RMM/EX/26-27/56..59.
 *
 *   pnpm --filter @rmm/api exec tsx --env-file=.env src/db/seed-order.ts
 *
 * Re-runnable: the company, masters, the proforma invoice and each lot's invoice are created only if
 * they do not exist yet, all through the same services as the screens (validation, numbering, totals,
 * parent balances, audit). If the company RMM already exists (e.g. you created it in the app), its
 * profile, logo and signature are kept and this data is added to it.
 */
import { add, DOCS, mul, type DocKey } from '@rmm/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from './client.js';
import { closeDb } from './client.js';
import { companies, docTables, masterTables, users } from './schema/index.js';
import { inCompanyTx, type RequestContext } from '../core/context.js';
import { createRecord } from '../modules/masters/masters.service.js';
import { createDocument, draftDocument } from '../modules/documents/documents.service.js';

type Row = Record<string, unknown>;

const COMPANY_CODE = 'RMM';
const BUYER_PO = '4200001676';

/** Both packings are a 40 KG master bag (so bags = net ÷ 40 and tare 0.8 KG/bag hold for every lot). */
const PACKINGS = {
  '4X10': { code: 'JUTE-4X10', name: '4 × 10 KG jute bag (40 KG master)', material: 'Jute', netWeightKg: '40', tareWeightKg: '0.800', description: '4 × 10 KG jute bags with zipper, in a master PP bag' },
  '8X5': { code: 'JUTE-8X5', name: '8 × 5 KG jute bag (40 KG master)', material: 'Jute', netWeightKg: '40', tareWeightKg: '0.800', description: '8 × 5 KG jute bags with zipper, in a master PP bag' },
} as const;
type PackKey = keyof typeof PACKINGS;

const PRODUCT = {
  code: 'BAS-WS-ZA',
  name: 'Indian Basmati Rice – White Sella (Zero Ageing)',
  variety: 'Basmati',
  riceType: 'White Sella',
  grade: '60% Pusa Sella + 40% 1886 Zero Ageing',
  hsnCode: '10063012',
  avgGrainLength: '6.61',
  brokenPct: '2',
  moisturePct: '13',
} as const;

const PAYMENT_TERM = { code: 'LC-SIGHT', name: 'LC at sight', termType: 'LC at sight', advancePct: '0', creditDays: 0, printText: 'Payment at sight under LC' } as const;

interface Lot {
  invoiceNumber: string;
  date: string;
  pack: PackKey;
  packingText: string;
  netMt: string;
  rate: string;
  containerNetKg: string;
  containerGrossKg: string;
  bagsPerContainer: number;
  blNumber: string;
  shippingBillNumber: string;
  placeOfReceipt: string;
  containers: [string, string][]; // [container no, seal no]
}

const LOTS: Lot[] = [
  {
    invoiceNumber: 'RMM/EX/26-27/57', date: '2026-08-07', pack: '4X10', packingText: '4 × 10 KG jute bags with zipper & master PP bags',
    netMt: '524.400', rate: '1005', containerNetKg: '22800', containerGrossKg: '23256', bagsPerContainer: 570,
    blNumber: 'MUNJED26172780', shippingBillNumber: '6235636', placeOfReceipt: 'Mundra',
    containers: [
      ['DPWU2083829', 'UFL507661'], ['DPWU2135650', 'UFL507662'], ['DPWU2150491', 'UFL507663'], ['DPWU2117019', 'UFL443433'],
      ['TIIU2286161', 'UFL507665'], ['DPWU2062220', 'UFL507666'], ['DPWU2153063', 'UFL507667'], ['DPWU2143240', 'UFL507668'],
      ['TEMU4889674', 'UFL507669'], ['DPWU2025268', 'UFL507670'], ['DRYU3048839', 'UFL507671'], ['DPWU2142428', 'UFL507672'],
      ['DPWU2024410', 'UFL507673'], ['DPWU2156041', 'UFL507674'], ['TIIU2436560', 'UFL507675'], ['DPWU2005826', 'UFL507676'],
      ['CAAU2481603', 'UFL507577'], ['DPWU2131589', 'UFL507678'], ['DPWU2090833', 'UFL507679'], ['DPWU2135500', 'UFL507680'],
      ['DPWU2020034', 'UFL507619'], ['BMOU1210786', 'UFL507563'], ['SEGU3375437', 'UFL507677'],
    ],
  },
  {
    invoiceNumber: 'RMM/EX/26-27/56', date: '2026-08-06', pack: '4X10', packingText: '4 × 10 KG jute bags with zipper & master PP bags',
    netMt: '570.000', rate: '1005', containerNetKg: '22800', containerGrossKg: '23256', bagsPerContainer: 570,
    blNumber: 'MUNJED26172779', shippingBillNumber: '5827378', placeOfReceipt: 'Mundra',
    containers: [
      ['DPWU2053906', 'UFL507681'], ['DPWU2060762', 'UFL507682'], ['DPWU2076603', 'UFL507683'], ['DPWU2070816', 'UFL507684'],
      ['SEKU1109181', 'UFL507685'], ['DPWU2106056', 'UFL507686'], ['DPWU2133093', 'UFL507687'], ['DPWU2197101', 'UFL507688'],
      ['BSIU2612867', 'UFL507689'], ['DPWU2011074', 'UFL507690'], ['DPWU2046717', 'UFL507691'], ['DPWU2047884', 'UFL507692'],
      ['DPWU2191340', 'UFL507693'], ['DPWU2004645', 'UFL507694'], ['LYGU3195450', 'UFL507695'], ['TIIU2243977', 'UFL507696'],
      ['DPWU2059139', 'UFL507697'], ['DPWU2097798', 'UFL507698'], ['DPWU2085312', 'UFL507699'], ['DPWU2189030', 'UFL507700'],
      ['DPWU2107957', 'UFL507605'], ['DPWU2116199', 'UFL507606'], ['DPWU2186679', 'UFL507614'], ['DPWU2086978', 'UFL507618'],
      ['SEGU3974097', 'UFL507620'],
    ],
  },
  {
    invoiceNumber: 'RMM/EX/26-27/58', date: '2026-08-08', pack: '8X5', packingText: '8 × 5 KG jute bags with zipper & master PP bags',
    netMt: '506.000', rate: '1038', containerNetKg: '22000', containerGrossKg: '22440', bagsPerContainer: 550,
    blNumber: 'MUNJED26172781', shippingBillNumber: '6095513', placeOfReceipt: 'Mundra',
    containers: [
      ['DPWU2119578', 'UFL507641'], ['DPWU2133452', 'UFL507642'], ['SEKU1107825', 'UFL507643'], ['DPWU2051098', 'UFL507644'],
      ['DPWU2159499', 'UFL507654'], ['SEKU1105669', 'UFL507647'], ['DPWU2118205', 'UFL507648'], ['DPWU2103360', 'UFL507649'],
      ['DPWU2162023', 'UFL507650'], ['DPWU2104449', 'UFL507651'], ['DPWU2210374', 'UFL507652'], ['DPWU2049974', 'UFL507653'],
      ['DPWU2175289', 'UFL507645'], ['DPWU2031321', 'UFL507655'], ['DPWU2030958', 'UFL507656'], ['DPWU2115850', 'UFL507657'],
      ['DPWU2098897', 'UFL507658'], ['DPWU2201602', 'UFL507659'], ['DPWU2072676', 'UFL507660'], ['DPWU2026290', 'UFL507590'],
      ['DPWU2078376', 'UFL507589'], ['DPWU2190961', 'UFL507595'], ['DPWU2013288', 'UFL510472'],
    ],
  },
  {
    invoiceNumber: 'RMM/EX/26-27/59', date: '2026-08-08', pack: '8X5', packingText: '8 × 5 KG jute bags with zipper & master PP bags',
    netMt: '396.000', rate: '1038', containerNetKg: '22000', containerGrossKg: '22440', bagsPerContainer: 550,
    blNumber: '', shippingBillNumber: '', placeOfReceipt: 'Kandla',
    containers: [
      ['DPWU2105928', 'UFL507725'], ['LYGU3197431', 'UFL507728'], ['LEGU2037526', 'UFL507729'], ['DPWU2052514', 'UFL509522'],
      ['DPWU2055236', 'UFL505003'], ['DPWU2050553', 'UFL505010'], ['DPWU2094510', 'UFL507721'], ['DPWU2079027', 'UFL507722'],
      ['DPWU2164134', 'UFL507724'], ['DPWU2067108', 'UFL507730'], ['DPWU2044801', 'UFL507732'], ['DPWU2005370', 'UFL507733'],
      ['DPWU2157808', 'UFL496873'], ['DPWU2007942', 'UFL505079'], ['DPWU2098747', 'UFL505012'], ['DPWU2071448', 'UFL505017'],
      ['DPWU2083285', 'UFL505019'], ['DPWU2108790', 'UFL505020'],
    ],
  },
];

// ------------------------------------------------------------------ helpers (same rules as the screens)
const pick = (fields: { name: string }[], src: Row) => Object.fromEntries(fields.filter((f) => src[f.name] !== undefined).map((f) => [f.name, src[f.name]]));

function payload(key: DocKey, src: Row & { lines: Row[]; terms: Row[]; containers?: Row[] }) {
  const def = DOCS[key];
  return {
    ...pick(def.header, src),
    lines: src.lines.map((l) => ({ ...pick(def.lines, l), sourceLineId: l.sourceLineId ?? null })),
    terms: src.terms.map((t) => ({ tcTemplateId: t.tcTemplateId ?? null, content: t.content })),
    containers: (src.containers ?? []).map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !['id', 'companyId', 'documentId', 'position'].includes(k)))),
  };
}

/** Bags and gross weight (MT) for a net weight in MT — 40 KG master bag, 0.8 KG tare/bag. */
function packed(qty: string) {
  const bags = Math.round((Number(qty) * 1000) / 40);
  return { noOfBags: bags, grossWtMt: add([qty, mul(mul(String(bags), '0.800', 6), '0.001', 3)], 3) };
}

async function globalId(tx: Tx, key: string, code: string): Promise<string> {
  const t = masterTables[key];
  const [row] = await tx.select({ id: t.id }).from(t).where(and(eq(t.code, code), isNull(t.deletedAt))).limit(1);
  if (!row) throw new Error(`Global master ${key} "${code}" not found — run "pnpm db:seed" first.`);
  return row.id as string;
}

/** Find a company master row by a field, or create it; returns its id. */
async function findOrCreate(tx: Tx, ctx: RequestContext, key: string, field: string, value: string, make: () => Row): Promise<string> {
  const t = masterTables[key];
  const [row] = await tx.select({ id: t.id }).from(t).where(and(eq(t[field], value), isNull(t.deletedAt))).limit(1);
  if (row) return row.id as string;
  return (await createRecord(tx, ctx, key, make())).id as string;
}

// ------------------------------------------------------------------ load
export async function loadOrder() {
  const [admin] = await inCompanyTx(null, (tx) =>
    tx.select({ id: users.id, username: users.username }).from(users).where(and(eq(users.isSuperAdmin, true), isNull(users.deletedAt))).limit(1),
  );
  if (!admin) throw new Error('No super admin found. Run "pnpm db:seed" first.');
  const ctx: RequestContext = { userId: admin.id, sessionId: 'seed-order', username: admin.username, isSuperAdmin: true, companyId: null, permissions: new Set(), ip: '127.0.0.1' };

  // 1) company (find or create)
  const companyId = await inCompanyTx(null, async (tx) => {
    const [existing] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.code, COMPANY_CODE), isNull(companies.deletedAt))).limit(1);
    if (existing) return existing.id as string;
    const inr = await globalId(tx, 'currencies', 'INR');
    const india = await globalId(tx, 'countries', 'IN');
    const company = await createRecord(tx, ctx, 'companies', {
      code: COMPANY_CODE,
      name: 'RMM Agro Exports',
      legalName: 'RMM Agro Exports Private Limited',
      addressLine1: 'C-1 to C-7 and E-12 to E-17, Foods Park, Kallukhapa',
      addressLine2: 'Pachmari Road, Pipariya',
      city: 'Pipariya',
      state: 'Madhya Pradesh',
      pincode: '461775',
      countryId: india,
      phone: '8889913555',
      email: 'rmmagroexportspvtltd@gmail.com',
      gstin: '23AAJCR4596A1ZF',
      iec: 'AAJCR4596A',
      pan: 'AAJCR4596A',
      lutNo: 'AD230426000317L',
      baseCurrencyId: inr,
      fyStartMonth: 4,
      signatoryName: 'Authorised Signatory',
      signatoryDesignation: 'Director',
    });
    return company.id as string;
  });

  const c: RequestContext = { ...ctx, companyId };
  const created: string[] = [];

  // 2) masters + 3) documents, in this company's scope
  await inCompanyTx(companyId, async (tx) => {
    const usd = await globalId(tx, 'currencies', 'USD');
    const india = await globalId(tx, 'countries', 'IN');
    const saudi = await globalId(tx, 'countries', 'SA');
    const mundra = await globalId(tx, 'ports', 'INMUN1');
    const jeddah = await globalId(tx, 'ports', 'SAJED');
    const mt = await globalId(tx, 'units', 'MT');
    const [usdRateRow] = await tx.select({ r: masterTables.currencies.exchangeRate }).from(masterTables.currencies).where(eq(masterTables.currencies.id, usd));
    const usdRate = String(usdRateRow?.r ?? '84');

    const termId = await findOrCreate(tx, c, 'paymentTerms', 'code', PAYMENT_TERM.code, () => ({ ...PAYMENT_TERM }));
    const packId: Record<PackKey, string> = {
      '4X10': await findOrCreate(tx, c, 'packingTypes', 'code', PACKINGS['4X10'].code, () => ({ ...PACKINGS['4X10'] })),
      '8X5': await findOrCreate(tx, c, 'packingTypes', 'code', PACKINGS['8X5'].code, () => ({ ...PACKINGS['8X5'] })),
    };
    const productId = await findOrCreate(tx, c, 'products', 'code', PRODUCT.code, () => ({
      ...PRODUCT,
      defaultUnitId: mt,
      cropYear: '2025',
      invoiceDescription: 'Indian Basmati Rice, 60% Pusa Sella and 40% 1886 Zero Ageing, broken 2% max, double polished, crop 2025',
    }));
    const bankId = await findOrCreate(tx, c, 'bankAccounts', 'accountNumber', '924020050929501', () => ({
      label: 'Axis Bank USD',
      bankName: 'Axis Bank',
      branch: 'Export branch',
      accountName: 'RMM Agro Exports Private Limited',
      accountNumber: '924020050929501',
      swiftCode: 'AXISINBB044',
      adCode: '6360044-7640009',
      currencyId: usd,
      isDefault: true,
    }));
    const buyerId = await findOrCreate(tx, c, 'customers', 'code', 'MAYAR', () => ({
      code: 'MAYAR',
      name: 'Mayar Foods Co.',
      address: 'PO Box No. 8495, Dammam 3806-32221',
      city: 'Dammam',
      countryId: saudi,
      defaultCurrencyId: usd,
      paymentTermId: termId,
      defaultPortId: jeddah,
      incoterm: 'FOB',
      phone: '013 845 5555',
    }));
    const consigneeId = await findOrCreate(tx, c, 'customers', 'code', 'BANKALBILAD', () => ({
      code: 'BANKALBILAD',
      name: 'To the order of Bank Al Bilad',
      address: 'PO Box No. 8495, Dammam 3806-32221, Kingdom of Saudi Arabia',
      city: 'Dammam',
      countryId: saudi,
      defaultCurrencyId: usd,
      incoterm: 'FOB',
    }));

    const commonSpec = {
      brand: 'Al Walimah Style',
      specVariety: 'Indian Basmati Rice (60% Pusa Sella + 40% 1886 Zero Ageing)',
      specAvgLengthMm: '6.61',
      specMoisturePct: '13',
      specBrokenPct: '2',
      specCropYear: '2025',
    };
    const line = (pack: PackKey, packingText: string, qtyMt: string, rate: string) => ({
      productId,
      packingTypeId: packId[pack],
      packingText,
      hsCode: '10063012',
      cropYear: '2025',
      quantityMt: qtyMt,
      ratePerMt: rate,
      brokenPct: '2',
      ...packed(qtyMt),
    });

    // ---- Proforma invoice: the whole order (2000 MT). Reuse if it already exists for this buyer PO.
    const piH = docTables.proformaInvoices.header;
    let [piRow] = await tx.select({ id: piH.id }).from(piH).where(and(eq(piH.buyerPoRef, BUYER_PO), isNull(piH.deletedAt))).limit(1);
    if (!piRow) {
      const piDraft = (await draftDocument(tx, c, 'proformaInvoices')) as Row & { lines: Row[]; terms: Row[] };
      const pi = await createDocument(
        tx,
        c,
        'proformaInvoices',
        payload('proformaInvoices', {
          ...piDraft,
          documentDate: '2026-07-19',
          status: 'CONFIRMED',
          buyerId,
          consigneeId,
          notifyPartyId: buyerId,
          buyerPoRef: BUYER_PO,
          poDate: '2026-07-19',
          lcNumber: 'IM2620133003',
          lcDate: '2026-07-20',
          incoterm: 'FOB',
          currencyId: usd,
          exchangeRate: usdRate,
          paymentTermId: termId,
          paymentTerms: 'Payment at sight under LC',
          deliveryTimeline: 'August 2026',
          originCountryId: india,
          portOfLoadingId: mundra,
          portOfDischargeId: jeddah,
          destinationCountryId: saudi,
          finalDestination: 'Jeddah Port',
          modeOfShipment: 'By sea, FCL containers',
          bankAccountId: bankId,
          ...commonSpec,
          lines: [line('4X10', '4 × 10 KG jute bags with zipper & master PP bags', '2000', '1005')],
        }),
      );
      piRow = { id: (pi as Row).id as string };
      created.push('PI (2000 MT order)');
    }
    const piId = piRow.id as string;

    // ---- One production order + one commercial invoice per lot (skip lots already loaded).
    const invH = docTables.commercialInvoices.header;
    for (const lot of LOTS) {
      const [done] = await tx.select({ id: invH.id }).from(invH).where(and(eq(invH.documentNumber, lot.invoiceNumber), isNull(invH.deletedAt))).limit(1);
      if (done) continue;

      const poDraft = (await draftDocument(tx, c, 'productionOrders', piId)) as Row & { lines: Row[]; terms: Row[] };
      poDraft.lines = [{ ...poDraft.lines[0], ...line(lot.pack, lot.packingText, lot.netMt, lot.rate) }];
      const po = await createDocument(
        tx,
        c,
        'productionOrders',
        payload('productionOrders', {
          ...poDraft,
          documentDate: lot.date,
          status: 'COMPLETED',
          dispatchSchedule: lot.date,
          fcl: `${lot.containers.length} × 20FT`,
          preCarriageBy: 'Road',
          placeOfReceipt: lot.placeOfReceipt,
          termsOf: 'FOB',
          millingInstructions: 'Sortex cleaned, double polished, broken 2% max; fumigate every lot before stuffing.',
          packagingInstructions: `Pack in ${lot.packingText}; print brand "Al Walimah Style" and lot number on every bag.`,
          transport: `Own trucks to ${lot.placeOfReceipt}`,
          ...commonSpec,
        }),
      );

      const invDraft = (await draftDocument(tx, c, 'commercialInvoices', (po as Row).id as string)) as Row & { lines: Row[]; terms: Row[] };
      const containers = lot.containers.map(([containerNumber, sealNumber]) => ({
        containerNumber,
        sealNumber: sealNumber.replace(/\s+/g, ''),
        containerSize: '20FT',
        totalBags: lot.bagsPerContainer,
        netWeightKg: lot.containerNetKg,
        grossWeightKg: lot.containerGrossKg,
      }));
      await createDocument(
        tx,
        c,
        'commercialInvoices',
        payload('commercialInvoices', {
          ...invDraft,
          documentNumber: lot.invoiceNumber,
          documentDate: lot.date,
          status: 'ISSUED',
          invoiceType: 'WHITE',
          buyerId,
          consigneeId,
          notifyPartyId: buyerId,
          buyerPoRef: BUYER_PO,
          poDate: '2026-07-19',
          lcNumber: 'IM2620133003',
          lcDate: '2026-07-20',
          incoterm: 'FOB',
          currencyId: usd,
          exchangeRate: usdRate,
          paymentTermId: termId,
          paymentTerms: 'Payment at sight under LC',
          originCountryId: india,
          portOfLoadingId: mundra,
          portOfDischargeId: jeddah,
          destinationCountryId: saudi,
          finalDestination: 'Jeddah Port',
          preCarriageBy: 'Road',
          placeOfReceipt: lot.placeOfReceipt,
          termsOf: 'FOB',
          blNumber: lot.blNumber,
          shippingBillNumber: lot.shippingBillNumber,
          fcl: `${lot.containers.length} × 20FT`,
          bankAccountId: bankId,
          marksNumbers: `AL WALIMAH STYLE BRAND\n${lot.containers.length} × 20' FCL — TOTAL ${packed(lot.netMt).noOfBags.toLocaleString('en-IN')} BAGS\nMADE IN INDIA`,
          goodsDescription: 'Indian Basmati Rice (60% Pusa Sella + 40% 1886 Zero Ageing), broken 2% max, 3/4 size maximum, double polished, crop year 2025.',
          ...commonSpec,
          lines: [{ ...invDraft.lines[0], ...line(lot.pack, lot.packingText, lot.netMt, lot.rate), sourceLineId: invDraft.lines[0]?.sourceLineId ?? null }],
          containers,
        }),
      );
      created.push(`${lot.invoiceNumber} (${lot.netMt} MT, ${lot.containers.length} containers)`);
    }
  });

  return { companyId, created };
}

const isMain = process.argv[1]?.endsWith('seed-order.ts') || process.argv[1]?.endsWith('seed-order.js');
if (isMain) {
  try {
    const { companyId, created } = (await loadOrder()) ?? { companyId: '', created: [] };
    console.log(`\n✔ RMM Agro Exports — Mayar Foods order (buyer PO ${BUYER_PO}).  company: ${companyId}`);
    console.log(created.length ? `  created: ${created.join(', ')}` : '  nothing new (already loaded).');
    console.log('  Sign in, switch to company RMM (Alt+C), open Sales → Commercial invoices.');
    await closeDb();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
