import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { Client, createSuperAdmin, makeApp, PASSWORD } from './helpers.js';

let app: FastifyInstance;
let root: Client;
const co = { A: '', B: '' };
const ids: Record<string, string> = {};

const pi = (qty: string) => ({
  documentDate: '2026-10-01',
  status: 'CONFIRMED',
  incoterm: 'FOB',
  buyerId: ids.buyer,
  currencyId: ids.usd,
  exchangeRate: '84',
  lines: [{ productId: ids.product, quantityMt: qty, ratePerMt: '1000' }],
  terms: [],
});
const bin = async (c: Client, query = '') => (await c.ok('GET', `/recycle-bin${query}`)) as { rows: { type: string; id: string; title: string; canRestore: boolean; deletedByName: string; reason: string }[]; total: number; counts: { type: string; count: number }[] };

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('bin-root');
  root = new Client(app);
  await root.login('bin-root');
  for (const k of ['A', 'B'] as const) co[k] = (await root.ok('POST', '/masters/companies', { code: `BIN${k}`, name: `Bin ${k}`, legalName: `Bin ${k} Pvt Ltd` })).id;
  await root.ok('POST', '/auth/switch-company', { companyId: co.A });
  await root.post('/masters/currencies', { code: 'USD', name: 'US Dollar', exchangeRate: 84 });
  ids.usd = ((await root.ok('GET', '/masters/currencies/lookup?q=USD')) as { id: string; label: string }[]).find((c) => c.label === 'USD')!.id;
  ids.buyer = (await root.ok('POST', '/masters/customers', { code: 'BUY1', name: 'Bin Buyer' })).id;
  ids.product = (await root.ok('POST', '/masters/products', { name: 'Bin Rice' })).id;
  ids.pi = (await root.ok('POST', '/documents/proformaInvoices', pi('100'))).id;
  const po = await root.ok('GET', `/documents/productionOrders/draft?from=${ids.pi}`);
  ids.po = (
    await root.ok('POST', '/documents/productionOrders', {
      ...Object.fromEntries(Object.entries(po).filter(([k]) => !k.endsWith('Label') && !['lines', 'terms', 'containers', 'amount'].includes(k))),
      lines: po.lines.map((l: Record<string, unknown>) => ({ productId: l.productId, quantityMt: l.quantityMt, sourceLineId: l.sourceLineId })),
      terms: [],
    })
  ).id;
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('recycle bin', () => {
  it('keeps deleted records and filters them by type, text, person and date', async () => {
    await root.ok('DELETE', `/documents/productionOrders/${ids.po}`, { reason: 'Mill changed' });
    await root.ok('DELETE', `/documents/proformaInvoices/${ids.pi}`, { reason: 'Buyer cancelled' });
    await root.ok('DELETE', `/masters/customers/${ids.buyer}`, { reason: 'Duplicate buyer' });

    const all = await bin(root);
    expect(all.rows.map((r) => r.type)).toEqual(expect.arrayContaining(['customers', 'proformaInvoices', 'productionOrders']));
    expect(all.rows.find((r) => r.type === 'customers')).toMatchObject({ title: 'Bin Buyer', reason: 'Duplicate buyer', deletedByName: 'bin-root', canRestore: true });
    expect((await bin(root, '?type=customers')).rows.every((r) => r.type === 'customers')).toBe(true);
    expect((await bin(root, '?search=mill')).rows.map((r) => r.type)).toEqual(['productionOrders']);
    expect((await bin(root, '?from=2000-01-01&to=2000-12-31')).total).toBe(0);
    expect((await bin(root, '?deletedBy=00000000-0000-4000-8000-000000000000')).total).toBe(0);
    expect(all.counts.find((c) => c.type === 'proformaInvoices')!.count).toBe(1);
    // another company's bin is separate
    await root.ok('POST', '/auth/switch-company', { companyId: co.B });
    expect((await bin(root, '?type=customers')).total).toBe(0);
    await root.ok('POST', '/auth/switch-company', { companyId: co.A });
  });

  it('restores in a safe order and refuses clashes', async () => {
    // the production order needs its PI back first
    const early = await root.post(`/recycle-bin/productionOrders/${ids.po}/restore`);
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/Restore proforma invoice/i);
    await root.ok('POST', `/recycle-bin/proformaInvoices/${ids.pi}/restore`);
    await root.ok('POST', `/recycle-bin/productionOrders/${ids.po}/restore`);
    expect((await root.ok('GET', `/documents/productionOrders/${ids.po}`)).deletedAt).toBeNull();

    // the buyer's code was reused meanwhile
    await root.ok('POST', '/masters/customers', { code: 'BUY1', name: 'New buyer' });
    const clash = await root.post(`/recycle-bin/customers/${ids.buyer}/restore`);
    expect(clash.status).toBe(409);
    expect(clash.body.message).toContain('BUY1');
  });

  it('sharing policies and users come back from the bin intact', async () => {
    const policy = (await root.ok('POST', '/sharing', { entity: 'products', targetCompanyId: co.B, access: 'read' })).id;
    await root.ok('DELETE', `/sharing/${policy}`);
    expect(((await root.ok('GET', '/sharing')) as { id: string }[]).some((p) => p.id === policy)).toBe(false);
    // a new policy for the same pair is allowed while the old one is in the bin
    const again = await root.ok('POST', '/sharing', { entity: 'products', targetCompanyId: co.B, access: 'write' });
    expect((await root.post(`/recycle-bin/sharing/${policy}/restore`)).status).toBe(409);
    await root.ok('DELETE', `/sharing/${again.id}`);
    await root.ok('POST', `/recycle-bin/sharing/${policy}/restore`);

    const role = (await root.ok('POST', '/roles', { name: 'Bin role', permissions: ['master.products:view'] })).id;
    const user = (await root.ok('POST', '/users', { username: 'bin-user', fullName: 'Bin User', password: PASSWORD, mustChangePassword: false, access: [{ companyId: co.A, roleIds: [role] }] })).id;
    await root.ok('DELETE', `/users/${user}`, { reason: 'Left the company' });
    // its old assignment no longer blocks deleting the role
    expect((await root.del(`/roles/${role}`)).status).toBe(200);
    await root.ok('POST', `/recycle-bin/roles/${role}/restore`);
    await root.ok('POST', `/recycle-bin/users/${user}/restore`);
    const back = new Client(app);
    await back.login('bin-user');
    expect((await back.get('/masters/products')).status).toBe(200); // access survived delete + restore
  });

  it('shows only what a user may view, and restores only with delete rights', async () => {
    await root.ok('DELETE', `/masters/products/${ids.product}`, { reason: 'Old product' });
    const role = (await root.ok('POST', '/roles', { name: 'Bin viewer', permissions: ['master.products:view'] })).id;
    await root.ok('POST', '/users', { username: 'bin-viewer', fullName: 'Bin Viewer', password: PASSWORD, mustChangePassword: false, access: [{ companyId: co.A, roleIds: [role] }] });
    const viewer = new Client(app);
    await viewer.login('bin-viewer');
    const seen = await bin(viewer);
    expect(new Set(seen.rows.map((r) => r.type))).toEqual(new Set(['products']));
    expect(seen.rows[0].canRestore).toBe(false);
    expect((await viewer.post(`/recycle-bin/products/${ids.product}/restore`)).status).toBe(403);
  });
});
