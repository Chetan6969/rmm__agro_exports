import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { Client, createSuperAdmin, makeApp, PASSWORD } from './helpers.js';

let app: FastifyInstance;
let root: Client;
let companyId = '';
const ids: Record<string, string> = {};

async function userWith(username: string, permissions: string[]) {
  const roleId = permissions.length ? (await root.ok('POST', '/roles', { name: `RBAC ${username}`, permissions })).id : null;
  await root.ok('POST', '/users', { username, fullName: username, password: PASSWORD, mustChangePassword: false, access: [{ companyId, roleIds: roleId ? [roleId] : [] }] });
  const c = new Client(app);
  await c.login(username);
  return c;
}

const pi = (total: string) => ({
  documentDate: '2026-10-01',
  status: 'CONFIRMED',
  incoterm: 'FOB',
  buyerId: ids.buyer,
  currencyId: ids.usd,
  exchangeRate: '84',
  lines: [{ productId: ids.product, quantityMt: total, ratePerMt: '1000' }],
  terms: [],
});

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('rbac-root');
  root = new Client(app);
  await root.login('rbac-root');
  companyId = (await root.ok('POST', '/masters/companies', { code: 'RBAC', name: 'RBAC Co', legalName: 'RBAC Co Pvt Ltd' })).id;
  await root.ok('POST', '/auth/switch-company', { companyId });
  await root.post('/masters/currencies', { code: 'USD', name: 'US Dollar', exchangeRate: 84 });
  ids.usd = ((await root.ok('GET', '/masters/currencies/lookup?q=USD')) as { id: string; label: string }[]).find((c) => c.label === 'USD')!.id;
  ids.buyer = (await root.ok('POST', '/masters/customers', { name: 'RBAC Buyer' })).id;
  ids.product = (await root.ok('POST', '/masters/products', { name: 'RBAC Rice' })).id;
  ids.piA = (await root.ok('POST', '/documents/proformaInvoices', pi('100'))).id;
  ids.piB = (await root.ok('POST', '/documents/proformaInvoices', pi('50'))).id;
  const inv = (piId: string) => ({ ...pi('10'), status: 'ISSUED', invoiceType: 'WHITE', proformaInvoiceId: piId, containers: [] });
  ids.ciA = (await root.ok('POST', '/documents/commercialInvoices', inv(ids.piA))).id;
  ids.ciB = (await root.ok('POST', '/documents/commercialInvoices', inv(ids.piB))).id;
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('a member with no permissions is refused everywhere', () => {
  it('every protected route answers 403', async () => {
    const nobody = await userWith('rbac-nobody', []);
    const routes: [('GET' | 'POST' | 'PUT' | 'DELETE'), string, unknown?][] = [
      ['GET', '/masters/customers'],
      ['GET', `/masters/customers/${ids.buyer}`],
      ['POST', '/masters/customers', { name: 'x' }],
      ['GET', '/masters/customers/export'],
      ['GET', '/defaults/customers'],
      ['PUT', '/defaults/customers', { values: {} }],
      ['GET', '/documents/proformaInvoices'],
      ['GET', `/documents/proformaInvoices/${ids.piA}`],
      ['GET', `/documents/proformaInvoices/${ids.piA}/pdf`],
      ['GET', '/documents/proformaInvoices/draft'],
      ['GET', '/documents/proformaInvoices/lookup?q='],
      ['GET', '/documents/proformaInvoices/export'],
      ['GET', '/documents/proformaInvoices/reports/field-usage?field=incoterm'],
      ['POST', '/documents/proformaInvoices', pi('1')],
      ['POST', `/documents/proformaInvoices/${ids.piA}/lock`, { locked: true }],
      ['POST', `/documents/proformaInvoices/${ids.piA}/reorder`, { direction: 'up' }],
      ['DELETE', `/documents/proformaInvoices/${ids.piA}`, { reason: 'x' }],
      ['GET', `/payments?invoice=${ids.ciA}`],
      ['POST', '/payments', { commercialInvoiceId: ids.ciA, paymentDate: '2026-10-02', amount: '1' }],
      ['GET', '/shipments'],
      ['GET', `/shipments/plan/${ids.piA}`],
      ['POST', '/shipments', { proformaInvoiceId: ids.piA, lotNo: 1, market: 'GULF', quantityMt: '10' }],
      ['GET', '/mis/overview'],
      ['GET', '/mis/reports?report=invoices'],
      ['GET', '/exchange-rates'],
      ['GET', '/numbering'],
      ['GET', '/audit'],
      ['GET', '/users'],
      ['GET', '/roles'],
      ['GET', '/sharing'],
    ];
    const allowed: string[] = [];
    for (const [method, url, body] of routes) {
      const res = await nobody.req(method, url, body ?? (method === 'GET' ? undefined : {}));
      if (res.status !== 403) allowed.push(`${method} ${url} → ${res.status}`);
    }
    expect(allowed).toEqual([]);
  });
});

describe('fixes from the RBAC review', () => {
  it('completing a shipment changes its invoice, so it needs invoice edit rights', async () => {
    const shipId = (
      await root.ok('POST', '/shipments', { proformaInvoiceId: ids.piA, lotNo: 1, market: 'GULF', quantityMt: '10', commercialInvoiceId: ids.ciA })
    ).id;
    const shipOnly = await userWith('rbac-ship', ['sales.shipments:view', 'sales.shipments:edit']);
    expect((await shipOnly.post(`/shipments/${shipId}/complete`)).status).toBe(403);
    const both = await userWith('rbac-ship-ci', ['sales.shipments:view', 'sales.shipments:edit', 'sales.commercialInvoices:view', 'sales.commercialInvoices:edit']);
    // a locked invoice cannot be changed this way either
    await root.ok('POST', `/documents/commercialInvoices/${ids.ciA}/lock`, { locked: true });
    expect((await both.post(`/shipments/${shipId}/complete`)).status).toBe(409);
    await root.ok('POST', `/documents/commercialInvoices/${ids.ciA}/lock`, { locked: false });
    expect((await both.post(`/shipments/${shipId}/complete`)).status).toBe(200);
    expect((await root.ok('GET', `/documents/commercialInvoices/${ids.ciA}`)).status).toBe('PAID');
  });

  it('shipment links must point at live documents of the same order', async () => {
    const other = await root.post('/shipments', { proformaInvoiceId: ids.piA, lotNo: 2, market: 'EU', quantityMt: '5', commercialInvoiceId: ids.ciB });
    expect(other.status).toBe(400);
    expect(other.body.fields.commercialInvoiceId).toBe('Other order');
    const ghost = await root.post('/shipments', { proformaInvoiceId: ids.piA, lotNo: 2, market: 'EU', quantityMt: '5', productionOrderId: '00000000-0000-4000-8000-000000000000' });
    expect(ghost.status).toBe(400);
    const lot = (await root.ok('POST', '/shipments', { proformaInvoiceId: ids.piA, lotNo: 3, market: 'EU', quantityMt: '5' })).id;
    expect((await root.post(`/shipments/${lot}/link-invoice`, { commercialInvoiceId: ids.ciB })).status).toBe(400);
  });

  it('master defaults are readable with view or create rights on that master', async () => {
    const viewer = await userWith('rbac-cust-view', ['master.customers:view']);
    expect((await viewer.get('/defaults/customers')).status).toBe(200);
    expect((await viewer.get('/defaults/products')).status).toBe(403);
  });

  it('MIS export is a permission of its own', async () => {
    const perms = (await root.ok('GET', '/meta/permissions')) as unknown;
    expect(JSON.stringify(perms)).toContain('mis.dashboard');
    const role = await root.post('/roles', { name: 'RBAC MIS export', permissions: ['mis.dashboard:view', 'mis.dashboard:export'] });
    expect(role.status).toBe(201);
  });
});
