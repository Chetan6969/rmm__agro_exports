import {
  applyTemplate,
  classify,
  extract,
  extractLines,
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
Delivery Terms and conditions A006 LC at Sight
Please supply the following Goods/ Services:
Item Material Description Quantity Unit Unit rate Total (USD)
10 9000000011 Sunrise 40 Kg FOB Mundra F10 DC Riyadh 46.080 MT 1000.00 / 1 MT 46080.00
20 9000000012 Sunrise 4X10 Kg FOB Mundra F20 DC Jeddah 23.040 MT 1020.00 / 1 MT 23500.80
Crop year 2026
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

  it('reads invoice totals printed under their labels, not the quantity as money', () => {
    const t = ['EXPORT INVOICE', 'TESTCO/EX/26-27/7', 'BANK A/C: 100000000000001', 'TOTAL FOB VALUE $', '1,23,456.00', '- TOTAL VALUE BEFORE TAX', '120.500', '', '1,23,456.00', 'TOTAL NET WEIGHT (MT)', '120.500', 'Amount Chargeable (in words)', '1,23,456.00'].join('\n');
    const x = extract(t, 'export_invoice');
    expect(x.fields.amount.value).toBe('123456');
    expect(x.fields.quantityMt.value).toBe('120.5');
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
  ids.buyer = (await root.ok('POST', '/masters/customers', { code: 'MAYR', name: 'Gulf Foods Co' })).id;
  ids.product = (await root.ok('POST', '/masters/products', { name: 'Sunrise basmati' })).id;
  ids.pack = (await root.ok('POST', '/masters/packingTypes', { code: 'J40', name: '40 KG jute bag', netWeightKg: 40, containerCapacityMt: 23.04 })).id;
  const country = (await root.ok('GET', '/masters/countries/lookup?q=Saudi')) as { id: string }[];
  const countryId = country[0]?.id ?? (await root.ok('POST', '/masters/countries', { code: 'SA', name: 'Saudi Arabia' })).id;
  ids.riyadh = (await root.ok('POST', '/masters/ports', { code: 'SARUH', name: 'Riyadh', countryId })).id;
  ids.jeddah = (await root.ok('POST', '/masters/ports', { code: 'SAJEX', name: 'Jeddah test', countryId })).id;
  ids.supplier = (await root.ok('POST', '/masters/suppliers', { code: 'UPK', name: 'Unique Packaging', supplierType: 'Packing material' })).id;
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
    expect(list[0]).toMatchObject({ supplierName: 'Unique Packaging', status: 'DRAFT' });
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
  });
});
