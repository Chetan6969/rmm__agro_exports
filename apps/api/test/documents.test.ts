import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { Client, createSuperAdmin, makeApp, PASSWORD } from './helpers.js';

let app: FastifyInstance;
let root: Client;
const co = { A: '', B: '' };
const m: Record<string, string> = {};

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
function upload(client: Client, buf: Buffer, name: string) {
  const boundary = '----d';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({ method: 'POST', url: '/api/files?scope=group', headers: { cookie: client.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
}

/** Strips server-only fields (labels, ids, totals) the way the web form does before saving. */
function payloadOf(doc: Record<string, any>, header: string[], lineFields: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of header) if (doc[k] !== undefined) out[k] = doc[k];
  out.lines = doc.lines.map((l: Record<string, unknown>) => {
    const x: Record<string, unknown> = { sourceLineId: l.sourceLineId ?? null };
    for (const k of lineFields) if (l[k] !== undefined) x[k] = l[k];
    return x;
  });
  out.terms = doc.terms.map((t: Record<string, unknown>) => ({ tcTemplateId: t.tcTemplateId ?? null, content: t.content }));
  out.containers = (doc.containers ?? []).map((c: Record<string, unknown>) => {
    const { id: _i, companyId: _c, documentId: _d, position: _p, ...rest } = c;
    return rest;
  });
  if (doc.version) out.version = doc.version;
  return out;
}

let meta: { key: string; header: { name: string }[]; lines: { name: string }[] }[] = [];
const fieldsOf = (key: string) => {
  const d = meta.find((x) => x.key === key)!;
  return [d.header.map((f) => f.name), d.lines.map((f) => f.name)] as const;
};
const save = (key: string, doc: Record<string, any>, id?: string) => {
  const [h, l] = fieldsOf(key);
  return id ? root.put(`/documents/${key}/${id}`, payloadOf(doc, h, l)) : root.post(`/documents/${key}`, payloadOf(doc, h, l));
};

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('docs-root');
  root = new Client(app);
  await root.login('docs-root');
  for (const k of ['A', 'B'] as const) {
    co[k] = (await root.ok('POST', '/masters/companies', { code: `DOC${k}`, name: `Docs ${k}`, legalName: `Docs ${k} Exports Pvt Ltd` })).id;
  }
  await root.ok('POST', '/auth/switch-company', { companyId: co.A });
  meta = await root.ok('GET', '/meta/documents');

  m.country = (await root.ok('POST', '/masters/countries', { code: 'ZZA', name: 'Testland A' })).id;
  m.dest = (await root.ok('POST', '/masters/countries', { code: 'ZZB', name: 'Testland B' })).id;
  m.pol = (await root.ok('POST', '/masters/ports', { code: 'ZZPOL', name: 'Test Loading Port', countryId: m.country, isLoading: true })).id;
  m.pod = (await root.ok('POST', '/masters/ports', { code: 'ZZPOD', name: 'Test Discharge Port', countryId: m.dest })).id;
  m.cur = (await root.ok('POST', '/masters/currencies', { code: 'XTS', name: 'Test currency', subunitName: 'Cents', exchangeRate: 80 })).id;
  m.buyer = (await root.ok('POST', '/masters/customers', { name: 'Gulf Foods LLC', address: 'PO Box 1\nTest City', countryId: m.dest })).id;
  m.product = (await root.ok('POST', '/masters/products', { name: '1121 Golden Sella Basmati', hsnCode: '10063020', invoiceDescription: 'Indian long grain basmati rice' })).id;
  m.pack = (await root.ok('POST', '/masters/packingTypes', { name: '40 KG non-woven bag', netWeightKg: 40, tareWeightKg: 0.15 })).id;
  m.bank = (await root.ok('POST', '/masters/bankAccounts', { label: 'Test USD', bankName: 'Test Bank', accountNumber: '000111', swiftCode: 'TESTINBB', isDefault: true })).id;
  m.term = (await root.ok('POST', '/masters/paymentTerms', { name: 'LC at sight', termType: 'LC at sight', printText: '100% irrevocable LC at sight' })).id;
  await root.ok('POST', '/masters/tcTemplates', { name: 'Standard PI', docType: 'Proforma Invoice', isDefault: true, body: '1. Weight at loading port is final.\n2) Shipment within 30 days of LC.' });

  const sig = (await upload(root, png, 'signature.png')).json().id;
  const company = (await root.get(`/masters/companies/${co.A}`)).body;
  await root.ok('PUT', `/masters/companies/${co.A}`, { version: company.version, lutNo: 'AD0000001', countryId: m.country, signatureFileId: sig, sealFileId: sig, signatoryName: 'A. Signer' });
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const piLines = () => [
  { productId: m.product, packingTypeId: m.pack, quantityMt: '100', ratePerMt: '1050.25', noOfBags: 2500, grossWtMt: '100.375' },
  { productId: m.product, packingTypeId: m.pack, quantityMt: '50.5', ratePerMt: '980', noOfBags: 1263 },
];

let pi: Record<string, any>;
let po: Record<string, any>;

describe('proforma invoice', () => {
  it('draft takes defaults from masters and the company profile', async () => {
    const d = await root.ok('GET', '/documents/proformaInvoices/draft');
    expect(d.status).toBe('CONFIRMED');
    expect(d.bankAccountId).toBe(m.bank);
    expect(d.originCountryId).toBe(m.country);
    expect(d.terms.map((t: { content: string }) => t.content)).toEqual(['Weight at loading port is final.', 'Shipment within 30 days of LC.']);
  });

  it('numbers automatically and computes totals and words on the server', async () => {
    const d = await root.ok('GET', '/documents/proformaInvoices/draft');
    const res = await save('proformaInvoices', {
      ...d,
      buyerId: m.buyer,
      currencyId: m.cur,
      exchangeRate: '80.5',
      paymentTermId: m.term,
      paymentTerms: '100% irrevocable LC at sight',
      portOfLoadingId: m.pol,
      portOfDischargeId: m.pod,
      freightAmount: '1000',
      discountAmount: '15',
      lines: piLines(),
    });
    expect(res.status).toBe(201);
    pi = res.body;
    expect(pi.documentNumber).toMatch(/^PI-DOCA\/\d{2}-\d{2}\/001$/);
    expect(pi).toMatchObject({ totalQuantityMt: '150.500', goodsAmount: '154515.00', grandTotal: '155500.00', totalBags: '3763' });
    expect(pi.amountInWords).toBe('XTS One Hundred Fifty-Five Thousand Five Hundred Only');
    expect(pi.lines[0]).toMatchObject({ amount: '105025.00', productIdLabel: '1121 Golden Sella Basmati' });
    expect(pi.terms).toHaveLength(2);
  });

  it('rejects a duplicate manual number and stale edits', async () => {
    const dup = await save('proformaInvoices', { ...pi, documentNumber: pi.documentNumber, version: undefined });
    expect(dup.status).toBe(409);
    expect(dup.body.fields.documentNumber).toBeTruthy();
    const stale = await save('proformaInvoices', { ...pi, version: pi.version + 1 }, pi.id);
    expect(stale.status).toBe(409);
  });
});

describe('production order generated against the PI', () => {
  it('draft copies the PI and its full quantity', async () => {
    const d = await root.ok('GET', `/documents/productionOrders/draft?from=${pi.id}`);
    expect(d).toMatchObject({ proformaInvoiceId: pi.id, buyerId: m.buyer, currencyId: m.cur, incoterm: 'FOB', portOfDischargeId: m.pod });
    expect(d.lines.map((l: { quantityMt: string }) => l.quantityMt)).toEqual(['100.000', '50.500']);
    expect(d.lines[0].sourceLineId).toBe(pi.lines[0].id);
  });

  it('allows up to the PI balance and never more', async () => {
    const d = await root.ok('GET', `/documents/productionOrders/draft?from=${pi.id}`);
    d.lines[1].quantityMt = '20';
    const res = await save('productionOrders', d);
    expect(res.status).toBe(201);
    po = res.body;
    expect(po.totalQuantityMt).toBe('120.000');

    const rest = await root.ok('GET', `/documents/productionOrders/draft?from=${pi.id}`);
    expect(rest.lines).toHaveLength(1);
    expect(rest.lines[0].quantityMt).toBe('30.500');
    // bags scale with the remaining weight: 1263 × 30.5 / 50.5 = 762.8 → 763
    expect(rest.lines[0].noOfBags).toBe(763);

    rest.lines[0].quantityMt = '31';
    const over = await save('productionOrders', rest);
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/more than the 30\.500 MT left/);
    expect(over.body.hint).toBeTruthy();
  });

  it('protects the PI while orders use it', async () => {
    const fresh = (await root.get(`/documents/proformaInvoices/${pi.id}`)).body;
    expect(fresh.children[0]).toMatchObject({ doc: 'productionOrders', usedMt: '120.000', remainingMt: '30.500' });
    const shrink = await save('proformaInvoices', { ...fresh, lines: [{ ...piLines()[0], quantityMt: '100' }] }, pi.id);
    expect(shrink.status).toBe(400);
    const cancel = await save('proformaInvoices', { ...fresh, status: 'CANCELLED' }, pi.id);
    expect(cancel.status).toBe(400);
    const del = await root.del(`/documents/proformaInvoices/${pi.id}`, { reason: 'test' });
    expect(del.status).toBe(400);
    expect(del.body.message).toContain(po.documentNumber);
  });
});

describe('commercial invoice generated against the production order', () => {
  let inv: Record<string, any>;
  it('inherits the PI link and applies charges by incoterm', async () => {
    const d = await root.ok('GET', `/documents/commercialInvoices/draft?from=${po.id}`);
    expect(d.proformaInvoiceId).toBe(pi.id);
    expect(d.lutNumber).toBe('AD0000001');
    const res = await save('commercialInvoices', {
      ...d,
      incoterm: 'CFR',
      thcCharge: '150',
      oceanFreightCharge: '2400',
      insuranceCharge: '300',
      containers: [
        { containerNumber: 'TCNU1234567', sealNumber: 'S1', containerSize: '20FT', totalBags: 650, netWeightKg: '26000', grossWeightKg: '26097.5' },
      ],
    });
    expect(res.status).toBe(201);
    inv = res.body;
    // FOB 100 × 1050.25 + 20 × 980 = 124625.00; CFR adds freight only (insurance is CIF-only)
    expect(inv).toMatchObject({ fobAmount: '124625.00', oceanFreightAmount: '2400.00', insuranceAmount: '0.00', insuranceCharge: '0.00', invoiceTotal: '127025.00', totalShippingCharge: '2550.00' });
    expect(inv.containers).toHaveLength(1);
  });

  it('cannot invoice more than the order holds', async () => {
    const d = await root.ok('GET', `/documents/commercialInvoices/draft?from=${po.id}`).catch((e: Error) => e);
    expect(d).toBeInstanceOf(Error);
    expect(String(d)).toMatch(/Nothing is left/);
    const extra = await save('commercialInvoices', { ...inv, documentNumber: '', version: undefined, containers: [] });
    expect(extra.status).toBe(400);
  });

  it('rejects containers whose gross weight is below net weight', async () => {
    const bad = await save('commercialInvoices', { ...inv, containers: [{ containerNumber: 'X1', sealNumber: 'S', containerSize: '20FT', totalBags: 1, netWeightKg: '100', grossWeightKg: '99' }] }, inv.id);
    expect(bad.status).toBe(400);
  });

  it('prints every document and the packing list as PDF', async () => {
    for (const [key, id] of [
      ['proformaInvoices', pi.id],
      ['productionOrders', po.id],
      ['commercialInvoices', inv.id],
    ]) {
      const res = await app.inject({ method: 'GET', url: `/api/documents/${key}/${id}/pdf`, headers: { cookie: root.cookie } });
      expect(res.statusCode, key).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    }
    const pl = await app.inject({ method: 'GET', url: `/api/documents/commercialInvoices/${inv.id}/packing-list.pdf`, headers: { cookie: root.cookie } });
    expect(pl.statusCode).toBe(200);
    expect(pl.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('reports, isolation and permissions', () => {
  it('groups PIs by any reportable field with readable labels', async () => {
    const r = await root.ok('GET', '/documents/proformaInvoices/reports/field-usage?field=portOfDischargeId');
    expect(r.rows[0]).toMatchObject({ value: 'Test Discharge Port', count: 1, quantityMt: '150.500' });
    const bad = await root.get('/documents/proformaInvoices/reports/field-usage?field=passwordHash');
    expect(bad.status).toBe(400);
    const terms = await root.ok('GET', '/documents/proformaInvoices/reports/terms-usage');
    expect(terms.map((t: { content: string }) => t.content)).toContain('Weight at loading port is final.');
  });

  it("another company cannot see or print this company's documents", async () => {
    await root.ok('POST', '/auth/switch-company', { companyId: co.B });
    expect((await root.get(`/documents/proformaInvoices/${pi.id}`)).status).toBe(404);
    expect((await root.ok('GET', '/documents/proformaInvoices')).total).toBe(0);
    expect((await root.get(`/documents/proformaInvoices/${pi.id}/pdf`)).status).toBe(404);
    await root.ok('POST', '/auth/switch-company', { companyId: co.A });
  });

  it('needs the sales permission', async () => {
    const role = (await root.ok('POST', '/roles', { name: 'PI viewer', permissions: ['sales.proformaInvoices:view'] })).id;
    await root.ok('POST', '/users', { username: 'pi-viewer', fullName: 'PI viewer', password: PASSWORD, mustChangePassword: false, access: [{ companyId: co.A, roleIds: [role] }] });
    const viewer = new Client(app);
    await viewer.login('pi-viewer');
    expect((await viewer.get('/documents/proformaInvoices')).status).toBe(200);
    expect((await viewer.get(`/documents/proformaInvoices/${pi.id}/pdf`)).status).toBe(403);
    expect((await viewer.get('/documents/commercialInvoices')).status).toBe(403);
    // document numbers are not readable through the lookup without permission either
    expect((await viewer.get('/documents/commercialInvoices/lookup?q=')).status).toBe(403);
    expect((await viewer.get('/documents/proformaInvoices/lookup?q=')).status).toBe(200);
    expect((await viewer.post('/documents/proformaInvoices', {})).status).toBe(403);
  });
});
