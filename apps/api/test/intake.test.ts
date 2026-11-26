import {
  applyTemplate,
  classify,
  extract,
  extractLines,
  findSupplierHints,
  matchSupplier,
  parseSupplierHintText,
  fixCode,
  innerPacks,
  learnTemplate,
  packagingNeeds,
  packKg,
  parseDocDate,
  planLots,
  type PlanLineInput,
} from '@rmm/shared';
import type { FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { whenIdle } from '../src/modules/intake/intake.service.js';
import { detectKind, readDocument, stopOcr } from '../src/modules/intake/read.js';
import { Client, createSuperAdmin, makeApp } from './helpers.js';

// Synthetic documents in the layouts seen in the export folders (no real company data).
const PO_TEXT = `Purchase Order
PO No
4200009999
Supplier Our Company Private Limited
Delivery Terms and conditions LC at Sight
Please supply the following Goods/ Services:
Item Material Description Quantity Unit Unit rate Total (USD)
10 9000000011 Sunrise 40 Kg FOB Mundra F10 DC Riyadh 46.080 MT 1000.00 / 1 MT 46080.00
20 9000000012 Sunrise 4X10 Kg FOB Mundra F20 DC Jeddah 23.040 MT 1020.00 / 1 MT 23500.80
Crop year 2026
`;
// a PO whose delivery schedule splits "10 Kg" items into 4 × 10 KG bags over two weeks
const SCHEDULE_PO = `Purchase Order
PO No
9000005555
Delivery schedule: As per the attached
Item Material Description Quantity Unit Unit rate Total (USD)
10 9000000011 Sunrise 10 Kg FOB Mundra F10 DC Riyadh 230.000 MT 1000.00 / 1 MT 230000.00
20 9000000011 Sunrise 10 Kg FOB Mundra F20 DC Jeddah 92.000 MT 1000.00 / 1 MT 92000.00
Kindly procure the Jute Bags from Unity Packaging, and seal from Kamal Enterprices
Delivery Schedule
SKU
Riyadh
Jeddah
Total
Tons
Month of Dispatch
SUNRISE RICE
4X10KG
115
46
161
Jan-27
P1
P3
SUNRISE RICE
4X10KG
115
46
161
Jan-27
P2
P3
`;

const SB_TEXT = `MUNDRA SEZ PORT, MUNDRA, GUJARAT Port Code SB No SB Date INMUN1 7299001 29-SEP-26 AAAAA0000A
INDIAN CUSTOMS EDI SYSTEM LET EXPORT COPY SHIPPING BILL SUMMARY
1 TESTCO/EX/26-27/7 123456 USD 9.LEO 30-SEP-26 14:18`;

function multipart(files: { name: string; body: Buffer | string }[]) {
  const boundary = '----rmmtest' + Date.now();
  const parts = files.map((f) => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body), Buffer.from('\r\n')]));
  return { payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('reading documents (pure rules)', () => {
  it('recognises a buyer PO and reads its item lines by pack and port', () => {
    const c = classify(PO_TEXT, '4200009999.pdf');
    expect(c.kind).toBe('buyer_po');
    const x = extract(PO_TEXT, 'buyer_po');
    expect(x.fields.buyerPoRef.value).toBe('4200009999');
    expect(x.fields.paymentTerms.value).toBe('LC at sight');
    expect(x.lines).toHaveLength(2);
    expect(x.lines[0]).toMatchObject({ buyerItemCode: '9000000011', packKg: 40, port: 'Riyadh', quantityMt: '46.080'.replace(/0+$/, '').replace(/\.$/, ''), rate: '1000' });
    expect(x.lines[1]).toMatchObject({ packKg: 40, port: 'Jeddah' });
    expect(x.fields.totalQuantityMt.value).toBe('69.12');
    expect(Number(x.fields.totalAmount.value)).toBeCloseTo(69580.8, 2);
  });

  it('reads the ICEGATE shipping bill block and our invoice number', () => {
    expect(classify(SB_TEXT, 'Shipping bill 7.pdf').kind).toBe('shipping_bill');
    const x = extract(SB_TEXT, 'shipping_bill');
    expect(x.fields).toMatchObject({ sbNumber: { value: '7299001' }, sbDate: { value: '2026-09-29' }, leoDate: { value: '2026-09-30' }, portCode: { value: 'INMUN1' } });
    expect(x.refs.invoiceNumbers).toEqual(['TESTCO/EX/26-27/7']);
  });

  it('fixes OCR letters in codes and reads dates as written on export papers', () => {
    expect(fixCode('ABCLINMUNOO1234')).toBe('ABCLINMUN001234');
    expect(fixCode('MAEU12345I78')).toBe('MAEU12345178');
    expect(parseDocDate('29-SEP-26')).toBe('2026-09-29');
    expect(parseDocDate('12/09/2026')).toBe('2026-09-12');
    expect(parseDocDate('Sep 29, 2026')).toBe('2026-09-29');
    expect(parseDocDate('46277')).toBe('2026-09-12');
    expect(packKg('Sunrise 4X10 Kg')).toBe(40);
    expect(innerPacks('8 x 5 kg')).toBe(8);
    expect(extractLines('Basmati rice 1121 sella 400 MT 850 USD PMT 340000')[0]).toMatchObject({ quantityMt: '400', rate: '850', amount: '340000' });
  });

  it("splits PO lines by the delivery schedule and reads whom to buy packaging from", () => {
    const x = extract(SCHEDULE_PO, 'buyer_po');
    expect(x.lines.map((l) => [l.port, l.quantityMt, l.packKg, l.packing, l.dispatchBy])).toEqual([
      ['Riyadh', '115', 40, '4 × 10 KG', '2027-01-15'],
      ['Riyadh', '115', 40, '4 × 10 KG', '2027-01-31'],
      ['Jeddah', '46', 40, '4 × 10 KG', '2027-01-15'],
      ['Jeddah', '46', 40, '4 × 10 KG', '2027-01-31'],
    ]);
    expect(x.fields.totalQuantityMt.value).toBe('322');
    expect(x.fields.totalAmount.value).toBe('322000');
    expect(parseSupplierHintText(x.fields.packagingSuppliers.value)).toEqual([
      { item: 'Jute Bags', supplier: 'Unity Packaging' },
      { item: 'seal', supplier: 'Kamal Enterprices' },
    ]);
    expect(findSupplierHints('Please procure rice from certified mills.')).toEqual([]);
    const masters = [{ name: 'KAMEL ENTERPRISES (CITY)' }, { name: 'Unity Packaging' }, { name: 'Other Traders' }];
    expect(matchSupplier('Kamal Enterprices', masters)?.name).toBe('KAMEL ENTERPRISES (CITY)');
    expect(matchSupplier('Nobody Packaging', masters)).toBeNull();
  });

  it('reads invoice totals printed under their labels, not the quantity as money', () => {
    const t = ['EXPORT INVOICE', 'TESTCO/EX/26-27/7', 'BANK A/C: 100000000000001', 'TOTAL FOB VALUE $', '1,23,456.00', '- TOTAL VALUE BEFORE TAX', '120.500', '', '1,23,456.00', 'TOTAL NET WEIGHT (MT)', '120.500', 'Amount Chargeable (in words)', '1,23,456.00'].join('\n');
    const x = extract(t, 'export_invoice');
    expect(x.fields.amount.value).toBe('123456');
    expect(x.fields.quantityMt.value).toBe('120.5');
  });

  it("reads a supplier bill's counted quantity, not the pack size in the item name", () => {
    const bill = (items: string[]) => ['Unity Packaging', 'TAX INVOICE', 'Invoice No: UP/9', 'Description HSN Qty Rate Amount', ...items, 'Grand Total 35,700.00'].join(String.fromCharCode(10));
    expect(extract(bill(['Jute bags 40 Kg printed 6305 800 Nos 42.50 34,000.00']), 'purchase_invoice').fields.quantity?.value).toBe('800');
    expect(extract(bill(['Jute bags 40 Kg 800 Nos 34,000.00', 'Tags 250 Nos 500.00']), 'purchase_invoice').fields.quantity).toBeUndefined();
    expect(extract(bill(['Jute bags 40 Kg 800 Nos', 'Tags 250 Nos', 'Total Qty 1050']), 'purchase_invoice').fields.quantity?.value).toBe('1050');
  });

  it('learns where a corrected value sits and reads it there next time', () => {
    const doc = 'ACME LINES LTD\nBooking ref.: XYZ-77812 / vessel MSC ANNA\nShipper: RMM';
    const t = learnTemplate(doc, 'bookingNo', 'XYZ-77812');
    expect(t).toMatchObject({ field: 'bookingNo', position: 'same-line' });
    const next = 'ACME LINES LTD\nBooking ref.: QQQ-12000 / vessel ONE APUS\nShipper: RMM';
    expect(applyTemplate(next, t!, 'text')?.value).toBe('QQQ-12000');
  });

  it('plans lots by dispatch window and port, with bags, containers and packaging', () => {
    const base = { packingTypeId: 'p40', packingName: '40 kg jute', packKg: 40, innerPacks: 1, containerLoadMt: 23.04 };
    const input: PlanLineInput[] = [
      { ...base, lineId: 'a', label: 'Riyadh 40kg', portId: 'r', portName: 'Riyadh', quantityMt: 552.96, dispatchBy: '2026-12-10' },
      { ...base, lineId: 'b', label: 'Jeddah 40kg', portId: 'j', portName: 'Jeddah', quantityMt: 46.08, dispatchBy: '2026-12-12' },
      { ...base, lineId: 'c', label: 'Jeddah later', portId: 'j', portName: 'Jeddah', quantityMt: 23.04, dispatchBy: '2027-01-20' },
    ];
    const lots = planLots(input, { maxContainersPerLot: 24, defaultContainerLoadMt: 23 });
    expect(lots.map((l) => [l.period, l.containers])).toEqual([
      ['Dec 2026 · P1', 2],
      ['Dec 2026 · P1', 24],
      ['Jan 2027 · P2', 1],
    ]);
    expect(lots[1]).toMatchObject({ quantityMt: 552.96, bags: 13824, targetShipDate: '2026-12-15' });
    const needs = packagingNeeds([{ packingTypeId: 'p10', packingName: '4 x 10 kg', bags: 1000, innerPacks: 4 }], 2);
    expect(needs.find((n) => n.component === 'outer')?.quantity).toBe(1020);
    expect(needs.find((n) => n.component === 'inner')?.quantity).toBe(4080);
    expect(needs.find((n) => n.component === 'seal')?.quantity).toBe(1020);
  });

  it('reads Excel files on the server (no OCR needed)', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Export Invoice No.', 'Date'], ['TESTCO/EX/26-27/7', '12-Sep-26'], ['Net Weight', '400 MT']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const k = detectKind(buf, 'Export Invoice 7.xlsx');
    expect(k?.kind).toBe('xlsx');
    const r = await readDocument(buf, k!.kind, k!.mime);
    expect(r.method).toBe('text');
    const x = extract(r.text, 'export_invoice');
    expect(x.fields).toMatchObject({ invoiceNumber: { value: 'TESTCO/EX/26-27/7' }, invoiceDate: { value: '2026-09-12' }, quantityMt: { value: '400' } });
    expect(detectKind(Buffer.from('MZ\x90\x00'), 'evil.exe')).toBeNull();
  });
});

let app: FastifyInstance;
let root: Client;
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('intake-root');
  root = new Client(app);
  await root.login('intake-root');
  ids.co = (await root.ok('POST', '/masters/companies', { code: 'TESTCO', name: 'Test Exports', legalName: 'Test Exports Pvt Ltd' })).id;
  await root.ok('POST', '/auth/switch-company', { companyId: ids.co });
  await root.post('/masters/currencies', { code: 'USD', name: 'US Dollar', exchangeRate: 84 });
  ids.usd = ((await root.ok('GET', '/masters/currencies/lookup?q=USD')) as { id: string; label: string }[]).find((c) => c.label === 'USD')!.id;
  ids.buyer = (await root.ok('POST', '/masters/customers', { code: 'GFC1', name: 'Gulf Foods Co' })).id;
  ids.product = (await root.ok('POST', '/masters/products', { name: 'Sunrise basmati' })).id;
  ids.pack = (await root.ok('POST', '/masters/packingTypes', { code: 'J40', name: '40 KG jute bag', netWeightKg: 40, containerCapacityMt: 23.04 })).id;
  const country = (await root.ok('GET', '/masters/countries/lookup?q=Saudi')) as { id: string }[];
  const countryId = country[0]?.id ?? (await root.ok('POST', '/masters/countries', { code: 'SA', name: 'Saudi Arabia' })).id;
  ids.riyadh = (await root.ok('POST', '/masters/ports', { code: 'SARUH', name: 'Riyadh', countryId })).id;
  ids.jeddah = (await root.ok('POST', '/masters/ports', { code: 'SAJEX', name: 'Jeddah test', countryId })).id;
  ids.supplier = (await root.ok('POST', '/masters/suppliers', { code: 'UPK', name: 'Unity Packaging', supplierType: 'Packing material' })).id;
});

afterAll(async () => {
  await whenIdle();
  await stopOcr();
  await app.close();
  await closeDb();
});

const upload = async (files: { name: string; body: string | Buffer }[]) => {
  const m = multipart(files);
  const res = await app.inject({ method: 'POST', url: '/api/intake/upload', headers: { cookie: root.cookie, ...m.headers }, payload: m.payload });
  expect(res.statusCode).toBe(201);
  await whenIdle();
  return res.json() as { id: string; duplicateOf: string | null; error?: string }[];
};

describe('document inbox → order → plan → packaging → tracker', () => {
  it('reads an uploaded buyer PO and turns it into an order without a PI', async () => {
    const [up] = await upload([{ name: '4200009999.txt', body: PO_TEXT }]);
    const item = await root.ok('GET', `/intake/${up.id}`);
    expect(item).toMatchObject({ status: 'TO_REVIEW', kind: 'buyer_po', readMethod: 'text' });
    expect(item.lines).toHaveLength(2);
    // the same file again is recognised as a duplicate
    expect((await upload([{ name: 'again.txt', body: PO_TEXT }]))[0].duplicateOf).toBe(up.id);
    const r = await root.ok('POST', `/intake/${up.id}/confirm`, {
      kind: 'buyer_po',
      fields: { buyerPoRef: '4200009999', poDate: '2026-11-22', paymentTerms: 'LC at sight', incoterm: 'FOB', cropYear: '2026' },
      order: {
        buyerId: ids.buyer,
        currencyId: ids.usd,
        exchangeRate: '84',
        lines: [
          { productId: ids.product, packingTypeId: ids.pack, destinationPortId: ids.riyadh, quantityMt: '46.08', ratePerMt: '1000', dispatchBy: '2026-12-10', buyerItemCode: '9000000011' },
          { productId: ids.product, packingTypeId: ids.pack, destinationPortId: ids.jeddah, quantityMt: '23.04', ratePerMt: '1020', dispatchBy: '2026-12-20', buyerItemCode: '9000000012' },
        ],
      },
    });
    expect(r.result).toMatch(/^order:/);
    ids.order = r.result.slice(6);
    const order = await root.ok('GET', `/documents/proformaInvoices/${ids.order}`);
    expect(order).toMatchObject({ orderSource: 'Buyer PO / contract', buyerPoRef: '4200009999', status: 'CONFIRMED' });
    expect(order.lines).toHaveLength(2);
    const pdf = await app.inject({ method: 'GET', url: `/api/documents/proformaInvoices/${ids.order}/pdf`, headers: { cookie: root.cookie } });
    expect(pdf.statusCode).toBe(200);
    expect((await root.get(`/intake/${up.id}`)).body.status).toBe('CONFIRMED');
  });

  it('plans the lots automatically, works out packaging and makes the supplier PO', async () => {
    const prev = await root.ok('POST', `/planning/${ids.order}/preview`, { maxContainersPerLot: 26 });
    expect(prev.lots.map((l: { period: string; containers: number }) => [l.period, l.containers])).toEqual([
      ['Dec 2026 · P1', 2],
      ['Dec 2026 · P2', 1],
    ]);
    const applied = await root.ok('POST', `/planning/${ids.order}/apply`, { maxContainersPerLot: 26, market: 'GULF' });
    expect(applied.created).toBe(2);
    ids.lot1 = applied.lots[0].id;
    expect(applied.lots[0]).toMatchObject({ lotNo: 1, containerCount: 2, period: 'Dec 2026 · P1', targetShipDate: '2026-12-15' });
    expect(applied.lots[0].lines[0]).toMatchObject({ portName: 'Riyadh', bags: 1152, containers: 2 });
    // planning again needs the replace tick
    expect((await root.post(`/planning/${ids.order}/apply`, { market: 'GULF' })).status).toBe(409);

    const items = await root.ok('POST', `/planning/${ids.order}/packaging`, { freePct: 2 });
    const outer = items.find((i: { component: string }) => i.component === 'outer');
    expect(outer).toMatchObject({ bags: 1728, quantity: 1763 });
    for (const it of items) await root.ok('PUT', `/packaging-items/${it.id}`, { supplierId: ids.supplier, rate: it.component === 'outer' ? '42.5' : '1.2' });
    const po = await root.ok('POST', `/planning/${ids.order}/vendor-pos`, { deliveryBy: '2026-12-01' });
    expect(po.created).toHaveLength(1);
    const list = await root.ok('GET', `/vendor-pos?orderId=${ids.order}`);
    expect(list[0]).toMatchObject({ supplierName: 'Unity Packaging', status: 'DRAFT' });
    expect(Number(list[0].totalAmount)).toBeGreaterThan(70000);
    const pdf = await app.inject({ method: 'GET', url: `/api/vendor-pos/${list[0].id}/pdf`, headers: { cookie: root.cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    // everything is ordered now, so a recalculation adds nothing new to buy
    const again = await root.ok('POST', `/planning/${ids.order}/packaging`, { freePct: 2 });
    expect(again.every((i: { status: string }) => i.status === 'ORDERED')).toBe(true);
  });

  it('matches a shipping bill to its lot, updates tracking and ticks the checklist', async () => {
    await root.ok('PUT', `/shipments/${ids.lot1}/tracking`, { invoiceNumber: 'TESTCO/EX/26-27/7', shippingLine: 'FOLK', eta: '2026-01-01' });
    const [up] = await upload([{ name: 'Shipping bill 7.pdf.txt', body: SB_TEXT }]);
    const item = await root.ok('GET', `/intake/${up.id}`);
    expect(item).toMatchObject({ kind: 'shipping_bill', shipmentId: ids.lot1, orderId: ids.order });
    await root.ok('POST', `/intake/${up.id}/confirm`, { kind: 'shipping_bill', fields: { sbNumber: '7299001', sbDate: '2026-09-29', leoDate: '2026-09-30' }, orderId: ids.order, shipmentId: ids.lot1 });
    const lot = await root.ok('GET', `/shipments/${ids.lot1}/documents`);
    expect(lot.lot).toMatchObject({ sbNumber: '7299001', leoDate: '2026-09-30' });
    expect(lot.checklist.find((c: { kind: string }) => c.kind === 'shipping_bill')).toMatchObject({ status: 'RECEIVED', refNo: '7299001' });
    await root.ok('PUT', `/shipments/${ids.lot1}/documents/phytosanitary`, { status: 'NOT_NEEDED' });
    const tracker = await root.ok('GET', '/tracker?status=all');
    const row = tracker.find((r: { id: string }) => r.id === ids.lot1);
    expect(row).toMatchObject({ invoiceNumber: 'TESTCO/EX/26-27/7', sbNumber: '7299001', docsDone: 2, docsNeeded: 11, payment: 'PENDING' });
    expect(row.alerts).toEqual(expect.arrayContaining(['Vessel arrived, BL not received', 'LEO done, BL missing']));
  });

  it('turns a scheduled PO into dated lots and pre-fills the packaging suppliers', async () => {
    const pack = (await root.ok('POST', '/masters/packingTypes', { code: 'J4X10', name: '4 × 10 KG jute bag', netWeightKg: 40, containerCapacityMt: 23 })).id;
    const sealMaker = (await root.ok('POST', '/masters/suppliers', { code: 'KAM', name: 'Kamal Enterprises', supplierType: 'Packing material' })).id;
    const [up] = await upload([{ name: '9000005555.txt', body: SCHEDULE_PO }]);
    const item = await root.ok('GET', `/intake/${up.id}`);
    expect(item.suggest.lines[0].packing).toMatchObject({ id: pack });
    const r = await root.ok('POST', `/intake/${up.id}/confirm`, {
      kind: 'buyer_po',
      fields: { buyerPoRef: '9000005555', poDate: '2026-12-01', packagingSuppliers: item.fields.packagingSuppliers.value },
      order: {
        buyerId: ids.buyer,
        currencyId: ids.usd,
        exchangeRate: '84',
        lines: item.lines.map((l: { port: string; quantityMt: string; rate: string; dispatchBy: string }) => ({ productId: ids.product, packingTypeId: pack, destinationPortId: l.port === 'Riyadh' ? ids.riyadh : ids.jeddah, quantityMt: l.quantityMt, ratePerMt: l.rate, dispatchBy: l.dispatchBy })),
      },
    });
    const order = r.result.slice(6);
    const planned = await root.ok('POST', `/planning/${order}/apply`, { market: 'GULF' });
    expect(planned.lots.map((l: { period: string }) => l.period)).toEqual(['Jan 2027 · P1', 'Jan 2027 · P2']);
    const items = await root.ok('POST', `/planning/${order}/packaging`, {});
    const of = (c: string) => items.find((i: { component: string }) => i.component === c);
    expect(of('outer')).toMatchObject({ supplierId: ids.supplier, bags: 8050 });
    expect(of('inner')).toMatchObject({ perBag: '4.000' });
    expect(of('seal')).toMatchObject({ supplierId: sealMaker });
    expect(of('tag').supplierId).toBeNull();
    const view = await root.ok('GET', `/planning/${order}`);
    expect(view.supplierHints.map((h: { supplierName: string }) => h.supplierName)).toEqual(['Unity Packaging', 'Kamal Enterprises']);
  });

  it('keeps each order in its own file: lots, folders and documents never mix', async () => {
    const list = await root.ok('GET', '/order-files?state=all');
    expect(list.total).toBe(2);
    expect(list.rows.map((r: { buyerPoRef: string }) => r.buyerPoRef).sort()).toEqual(['9000005555', '4200009999'].sort());
    const found = await root.ok('GET', '/order-files?search=9000005555');
    expect(found.rows).toHaveLength(1);
    const other = found.rows[0].id;
    // a file uploaded into a lot folder stays in that order, whatever its text mentions
    const m = multipart([{ name: 'lot-note.txt', body: 'Phytosanitary certificate. Plant quarantine treatment 778899' }]);
    const res = await app.inject({ method: 'POST', url: `/api/intake/upload?shipmentId=${ids.lot1}`, headers: { cookie: root.cookie, ...m.headers }, payload: m.payload });
    expect(res.statusCode).toBe(201);
    await whenIdle();
    const [added] = res.json() as { id: string }[];
    expect(await root.ok('GET', `/intake/${added.id}`)).toMatchObject({ orderId: ids.order, shipmentId: ids.lot1 });

    const file = await root.ok('GET', `/order-files/${ids.order}`);
    expect(file.order.buyerPoRef).toBe('4200009999');
    expect(file.lots).toHaveLength(2);
    expect(file.folders.toReview.map((f: { fileName: string }) => f.fileName)).toContain('lot-note.txt');
    const lot1 = file.lots.find((l: { id: string }) => l.id === ids.lot1);
    expect(lot1.files.map((f: { label: string }) => f.label)).toContain('Shipping bill');
    expect(file.vendorPos).toHaveLength(1);
    expect(file.progress).toMatchObject({ lots: 2, shipped: 0, next: 'SHIP', toReview: 1 });

    const second = await root.ok('GET', `/order-files/${other}`);
    expect(second.lots.every((l: { files: unknown[] }) => l.files.length === 0)).toBe(true);
    expect(second.folders.toReview).toHaveLength(0);
    expect(second.vendorPos).toHaveLength(0);

    const groups = await root.ok('GET', '/intake/groups?status=ALL');
    expect(groups.groups.find((g: { orderId: string }) => g.orderId === ids.order).total).toBeGreaterThanOrEqual(3);
    const only = await root.ok('GET', `/intake?orderId=${other}&status=ALL`);
    expect(only.rows.map((r: { fileName: string }) => r.fileName)).toEqual(['9000005555.txt']);
    expect((await root.get('/order-files/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('keeps buying apart: supplier purchase orders and purchase invoices, per order', async () => {
    const BILL = ['TAX INVOICE', 'Unity Packaging', 'GSTIN: 24ABCDE1234F1Z5', 'Invoice No: UP/881', 'Invoice Date: 05-12-2026', 'Buyer: Test Exports Pvt Ltd', 'HSN 6305 Jute bags 40 Kg 1763 Nos 42.50 74927.50', 'Taxable Value 74927.50', 'IGST 3746.38', 'Grand Total 78673.88'];
    const [packPo] = await root.ok('GET', `/vendor-pos?orderId=${ids.order}`);
    BILL.push(`Against our order ${packPo.number}`);
    const m = multipart([{ name: 'unity-bill.txt', body: BILL.join(String.fromCharCode(10)) }]);
    const res = await app.inject({ method: 'POST', url: `/api/intake/upload?orderId=${ids.order}`, headers: { cookie: root.cookie, ...m.headers }, payload: m.payload });
    expect(res.statusCode).toBe(201);
    await whenIdle();
    const [up] = res.json() as { id: string }[];
    const item = await root.ok('GET', `/intake/${up.id}`);
    expect(item).toMatchObject({ kind: 'purchase_invoice', orderId: ids.order });
    expect(item.fields).toMatchObject({ invoiceNo: { value: 'UP/881' }, invoiceDate: { value: '2026-12-05' }, totalAmount: { value: '78673.88' } });
    expect(item.suggestBuy.supplier).toMatchObject({ id: ids.supplier });
    expect(item.suggestBuy.vendorPo).toMatchObject({ id: packPo.id });
    const body = { kind: 'purchase_invoice', fields: { invoiceNo: 'UP/881', invoiceDate: '2026-12-05', taxableAmount: '74927.50', gstAmount: '3746.38', totalAmount: '78673.88' }, orderId: ids.order, purchase: { supplierId: ids.supplier, category: 'PACKAGING', vendorPoId: packPo.id } };
    const done = await root.ok('POST', `/intake/${up.id}/confirm`, body);
    expect(done.result).toMatch(/^purchase-invoice:/);
    const billId = done.result.split(':')[1];
    const [bill] = await root.ok('GET', `/purchase-invoices?orderId=${ids.order}`);
    expect(bill).toMatchObject({ id: billId, invoiceNo: 'UP/881', supplierName: 'Unity Packaging', vendorPoNumber: packPo.number, orderSource: 'Buyer PO / contract', paymentStatus: 'UNPAID' });
    expect(bill.fileId).toBeTruthy();

    // the same bill cannot be entered twice, and a purchase order of another supplier cannot be linked
    const again = { invoiceNo: 'up/881', invoiceDate: '2026-12-05', supplierId: ids.supplier, totalAmount: '10' };
    expect((await root.post('/purchase-invoices', again)).status).toBe(409);
    const other = (await root.ok('POST', '/masters/suppliers', { code: 'MIL', name: 'Sunrise Mills', supplierType: 'Miller' })).id;
    expect((await root.post('/purchase-invoices', { ...again, invoiceNo: 'SM/1', supplierId: other, vendorPoId: packPo.id })).status).toBe(400);

    // a typed purchase order (not packaging) sits in the same order, listed by category
    const paddy = await root.ok('POST', '/vendor-pos', { poDate: '2026-12-02', supplierId: other, category: 'PADDY_RICE', proformaInvoiceId: ids.order, lines: [{ description: 'Paddy 1121', quantity: 10, unit: 'MT', rate: '30000' }] });
    expect(paddy).toMatchObject({ category: 'PADDY_RICE', totalAmount: '300000.00' });
    const onlyPaddy = await root.ok('GET', '/vendor-pos?category=PADDY_RICE');
    expect(onlyPaddy.map((p: { id: string }) => p.id)).toEqual([paddy.id]);

    const file = await root.ok('GET', `/order-files/${ids.order}`);
    expect(file.vendorPos).toHaveLength(2);
    expect(file.purchaseInvoices.map((b: { invoiceNo: string }) => b.invoiceNo)).toEqual(['UP/881']);
    expect(Number(file.vendorPos.find((p: { id: string }) => p.id === packPo.id).billedAmount)).toBeCloseTo(78673.88, 2);

    // the supplier's bill sits in the purchase folder, not among the buyer's order papers or the lots
    const names = (list: { fileName: string }[]) => list.map((x) => x.fileName);
    expect(names(file.folders.purchaseInvoices)).toEqual(['unity-bill.txt']);
    expect(names(file.folders.orderPapers)).not.toContain('unity-bill.txt');
    expect(names(file.lots.flatMap((l: { files: { fileName: string }[] }) => l.files))).not.toContain('unity-bill.txt');

    // buyer PO orders and our PIs can be listed apart
    expect((await root.ok('GET', '/order-files?state=all&source=po')).total).toBe(2);
    expect((await root.ok('GET', '/order-files?state=all&source=pi')).total).toBe(0);
    expect((await root.ok('GET', '/intake/groups?status=ALL&source=pi')).groups.filter((g: { orderId: string | null }) => g.orderId)).toHaveLength(0);

    const paid = await root.ok('PUT', `/purchase-invoices/${billId}`, { ...bill, vendorPoId: packPo.id, proformaInvoiceId: ids.order, paidAmount: '1000' });
    expect(Number(paid.paidAmount)).toBe(1000);
    expect((await root.ok('GET', '/purchase-invoices?status=PART')).map((b: { id: string }) => b.id)).toEqual([billId]);
    expect((await root.put(`/purchase-invoices/${billId}`, { ...bill, proformaInvoiceId: ids.order, paidAmount: '1' })).status).toBe(409);

    await root.ok('DELETE', `/purchase-invoices/${billId}`, { reason: 'Entered by mistake' });
    expect(await root.ok('GET', '/purchase-invoices')).toHaveLength(0);
    expect((await root.ok('GET', '/recycle-bin?type=purchaseInvoices')).rows[0]).toMatchObject({ reason: 'Entered by mistake' });
    await root.ok('POST', `/recycle-bin/purchaseInvoices/${billId}/restore`);
    expect(await root.ok('GET', '/purchase-invoices')).toHaveLength(1);
  });

  it('follows an order whose buyer, goods, packing and port were typed on the document', async () => {
    const order = await root.ok('POST', '/documents/proformaInvoices', {
      documentDate: '2026-12-03',
      buyerIdText: 'Walk In Trading FZE',
      currencyId: ids.usd,
      exchangeRate: '84',
      incoterm: 'FOB',
      lines: [{ productIdText: 'Golden sella rice', packingTypeIdText: '25 KG pp bag', destinationPortIdText: 'Typed Harbour', quantityMt: '46', ratePerMt: '900' }],
      terms: [],
    });
    const found = await root.ok('GET', '/order-files?state=all&search=Walk%20In');
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]).toMatchObject({ id: order.id, buyer: 'Walk In Trading FZE', orderSource: 'Our PI' });

    const applied = await root.ok('POST', `/planning/${order.id}/apply`, { market: 'GULF' });
    expect(applied.lots[0].lines[0]).toMatchObject({ portName: 'Typed Harbour', bags: 1840 });
    expect(applied.lots[0].lines[0].label).toContain('Golden sella rice');
    expect((await root.ok('GET', `/planning/${order.id}`)).order.buyer).toBe('Walk In Trading FZE');
    expect((await root.ok('GET', '/tracker?status=all&search=Walk%20In')).map((r: { buyer: string }) => r.buyer)).toEqual(applied.lots.map(() => 'Walk In Trading FZE'));
    const lots = await root.ok('GET', '/shipments');
    expect(lots.find((r: { id: string }) => r.id === applied.lots[0].id)).toMatchObject({ buyer: 'Walk In Trading FZE' });

    await root.ok('POST', '/purchase-invoices', { invoiceNo: 'UP/TYPED', invoiceDate: '2026-12-04', supplierId: ids.supplier, proformaInvoiceId: order.id, totalAmount: '10' });
    expect((await root.ok('GET', `/purchase-invoices?orderId=${order.id}`))[0].buyer).toBe('Walk In Trading FZE');
    const draft = await root.ok('GET', `/freight/enquiries/draft?shipmentId=${applied.lots[0].id}`);
    expect(draft.commodity).toBe('Golden sella rice');
    await root.ok('POST', '/freight/enquiries', { proformaInvoiceId: order.id, portOfLoading: 'Mundra', portOfDischarge: 'Typed Harbour', containerType: "20' FCL", containerCount: 2 });
    expect((await root.ok('GET', '/freight/enquiries')).find((e: { orderId: string }) => e.orderId === order.id).buyer).toBe('Walk In Trading FZE');
    const m = multipart([{ name: 'typed-note.txt', body: 'a note filed with this order 5551212' }]);
    await app.inject({ method: 'POST', url: `/api/intake/upload?orderId=${order.id}`, headers: { cookie: root.cookie, ...m.headers }, payload: m.payload });
    await whenIdle();
    expect((await root.ok('GET', '/intake/groups?status=ALL')).groups.find((g: { orderId: string }) => g.orderId === order.id).buyer).toBe('Walk In Trading FZE');
  });

  it('continues the purchase order series after a number typed by hand', async () => {
    const po = (number?: string) => root.ok('POST', '/vendor-pos', { number, poDate: '2026-12-05', supplierId: ids.supplier, category: 'OTHER', lines: [{ description: 'Pallets', quantity: 1, rate: '1' }] });
    const first = (await po()).number as string;
    const seq = /\d+$/.exec(first)![0];
    const typed = first.slice(0, -seq.length) + String(Number(seq) + 5).padStart(seq.length, '0');
    await po(typed);
    expect((await po()).number).toBe(first.slice(0, -seq.length) + String(Number(seq) + 6).padStart(seq.length, '0'));
  });

  it('remembers corrections for the same layout', async () => {
    const doc = (no: string) => `GLOBAL BOOKING CONFIRMATION\nACME SEA LINES\nOur reference ${no} please quote\nVessel: ACME STAR / 12E\nETD 05-12-2026`;
    const [a] = await upload([{ name: 'booking-a.txt', body: doc('ACM-555001') }]);
    const first = await root.ok('GET', `/intake/${a.id}`);
    expect(first.kind).toBe('booking');
    expect(first.fields.bookingNo?.value).not.toBe('ACM-555001');
    await root.ok('POST', `/intake/${a.id}/confirm`, { kind: 'booking', fields: { bookingNo: 'ACM-555001', vessel: 'ACME STAR / 12E', etd: '2026-12-05' }, orderId: ids.order, shipmentId: ids.lot1 });
    const [b] = await upload([{ name: 'booking-b.txt', body: doc('ACM-777002') }]);
    const second = await root.ok('GET', `/intake/${b.id}`);
    expect(second.fields.bookingNo).toMatchObject({ value: 'ACM-777002', source: 'template' });
    // the first booking also filled the lot
    expect((await root.ok('GET', `/shipments/${ids.lot1}/documents`)).lot).toMatchObject({ bookingNo: 'ACM-555001', etd: '2026-12-05' });
  });

  it('keeps deleted inbox documents in the recycle bin and needs the inbox permission', async () => {
    const [up] = await upload([{ name: 'misc.txt', body: 'random note about nothing in particular 12345' }]);
    await root.ok('DELETE', `/intake/${up.id}`, { reason: 'Not needed' });
    const bin = await root.ok('GET', '/recycle-bin?type=inbox');
    expect(bin.rows[0]).toMatchObject({ title: 'misc.txt', reason: 'Not needed' });
    await root.ok('POST', `/recycle-bin/inbox/${up.id}/restore`);
    expect((await root.get(`/intake/${up.id}`)).status).toBe(200);
    const role = (await root.ok('POST', '/roles', { name: 'No inbox', permissions: ['master.products:view'] })).id;
    await root.ok('POST', '/users', { username: 'no-inbox', fullName: 'No Inbox', password: 'Test-pass-123', mustChangePassword: false, access: [{ companyId: ids.co, roleIds: [role] }] });
    const u = new Client(app);
    await u.login('no-inbox');
    expect((await u.get('/intake')).status).toBe(403);
    expect((await u.get('/tracker')).status).toBe(403);
    expect((await u.get('/purchase-invoices')).status).toBe(403);
    expect((await u.post('/vendor-pos', {})).status).toBe(403);
  });
});
