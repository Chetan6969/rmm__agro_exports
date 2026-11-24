import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { loadDemo, resetDemo } from '../src/db/demo.js';
import { Client, createSuperAdmin, makeApp } from './helpers.js';

let app: FastifyInstance;
let root: Client;

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('demo-root');
  root = new Client(app);
  await root.login('demo-root');
  // baseline currencies normally come from "pnpm db:seed"; other test files may or may not have run first
  for (const [code, name] of [
    ['INR', 'Indian Rupee'],
    ['USD', 'US Dollar'],
    ['GBP', 'Pound Sterling'],
  ]) {
    const res = await root.post('/masters/currencies', { code, name, exchangeRate: 1 });
    expect([201, 409]).toContain(res.status);
  }
});

afterAll(async () => {
  await resetDemo();
  await app.close();
  await closeDb();
});

describe('demo data', () => {
  it('loads a complete demo company through the real services, once', async () => {
    const other = await root.ok('POST', '/masters/companies', { code: 'KEEPME', name: 'Keep me', legalName: 'Keep Me Pvt Ltd' });
    await root.ok('POST', '/auth/switch-company', { companyId: other.id });
    await root.ok('POST', '/masters/customers', { name: 'Real buyer' });

    const { companyId } = await loadDemo();
    await expect(loadDemo()).rejects.toThrow(/already loaded/);

    await root.ok('POST', '/auth/switch-company', { companyId });
    const pis = await root.ok('GET', '/documents/proformaInvoices');
    expect(pis.total).toBe(7);
    expect(pis.rows.map((r: { documentNumber: string }) => r.documentNumber)).toContain('PI-DEMO/26-27/001');
    const orders = await root.ok('GET', '/documents/productionOrders');
    expect(orders.total).toBe(4);
    const invoices = await root.ok('GET', '/documents/commercialInvoices');
    expect(invoices.total).toBe(2);
    // the fully shipped Al Noor PI: 390 MT invoiced in 15 containers, CFR adds ocean freight
    const full = (await root.ok('GET', `/documents/commercialInvoices/${invoices.rows.find((r: { totalQuantityMt: string }) => r.totalQuantityMt === '390.000').id}`)) as Record<string, any>;
    expect(full.containers).toHaveLength(15);
    expect(full.fobAmount).toBe('469950.00'); // 260 × 1185 + 130 × 1245
    expect(full.invoiceTotal).toBe('477750.00'); // + 15 × 520 ocean freight
    const pdf = await app.inject({ method: 'GET', url: `/api/documents/commercialInvoices/${full.id}/pdf`, headers: { cookie: root.cookie } });
    expect(pdf.statusCode).toBe(200);
  });

  it('reset removes only the demo company', async () => {
    expect(await resetDemo()).toBe(true);
    expect(await resetDemo()).toBe(false);
    const list = await root.ok('GET', '/masters/companies?pageSize=500');
    const codes = list.rows.map((r: { code: string }) => r.code);
    expect(codes).not.toContain('DEMO');
    expect(codes).toContain('KEEPME');
    const keep = list.rows.find((r: { code: string }) => r.code === 'KEEPME');
    await root.ok('POST', '/auth/switch-company', { companyId: keep.id });
    expect((await root.ok('GET', '/masters/customers')).rows.map((r: { name: string }) => r.name)).toContain('Real buyer');
  });
});
