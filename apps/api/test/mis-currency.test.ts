import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { Client, createSuperAdmin, makeApp } from './helpers.js';

let app: FastifyInstance;
let root: Client;
const ids: Record<string, string> = {};

/** ECB time series: on 2026-09-08, 1 EUR = 101 INR = 1.25 USD → 80.8 ₹ per $. */
function stubEcbHistory() {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('..')) return new Response('not stubbed', { status: 503 });
    return Response.json({
      amount: 1,
      base: 'EUR',
      start_date: '2026-09-01',
      end_date: '2026-09-08',
      rates: { '2026-09-07': { INR: 100, USD: 1.25 }, '2026-09-08': { INR: 101, USD: 1.25 } },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function currencyId(code: string, name: string) {
  await root.post('/masters/currencies', { code, name, exchangeRate: 1 });
  const hit = (await root.ok('GET', `/masters/currencies/lookup?q=${code}`)) as { id: string; label: string }[];
  return hit.find((c) => c.label === code)!.id;
}

const invoice = (currency: string, rate: string, qty: string, price: string) => ({
  documentDate: '2026-09-08',
  status: 'ISSUED',
  invoiceType: 'WHITE',
  incoterm: 'FOB',
  buyerId: ids.buyer,
  currencyId: ids[currency],
  exchangeRate: rate,
  lines: [{ productId: ids.product, quantityMt: qty, ratePerMt: price }],
  terms: [],
  containers: [],
});

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('mis-root');
  root = new Client(app);
  await root.login('mis-root');
  const co = await root.ok('POST', '/masters/companies', { code: 'MISFX', name: 'MIS FX', legalName: 'MIS FX Pvt Ltd' });
  await root.ok('POST', '/auth/switch-company', { companyId: co.id });
  ids.USD = await currencyId('USD', 'US Dollar');
  ids.GBP = await currencyId('GBP', 'Pound Sterling');
  ids.buyer = (await root.ok('POST', '/masters/customers', { name: 'FX Buyer' })).id;
  ids.product = (await root.ok('POST', '/masters/products', { name: 'FX Rice' })).id;
  // 10 MT × $1,000 = $10,000 billed at ₹84; 5 MT × £800 = £4,000 billed at ₹110 (= ₹440,000)
  await root.ok('POST', '/documents/commercialInvoices', invoice('USD', '84', '10', '1000'));
  await root.ok('POST', '/documents/commercialInvoices', invoice('GBP', '110', '5', '800'));
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('MIS reporting currency', () => {
  it('shows rupees at each invoice’s own billed rate', async () => {
    stubEcbHistory();
    const r = await root.ok('GET', '/mis/overview?ccy=INR');
    expect(Number(r.kpis.revenue)).toBeCloseTo(10000 * 84 + 440000, 2);
    expect(r.fx.currency).toBe('INR');
  });

  it('shows dollars by default: USD invoices as billed, others via ₹ at the ECB rate of the invoice date', async () => {
    const fetchMock = stubEcbHistory();
    const r = await root.ok('GET', '/mis/overview');
    expect(r.fx.currency).toBe('USD');
    expect(r.fx.problem).toBeUndefined();
    // $10,000 + ₹440,000 / 80.8 ₹ per $
    expect(Number(r.kpis.revenue)).toBeCloseTo(10000 + 440000 / 80.8, 2);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('base=EUR&symbols=INR,USD'))).toBe(true);

    const trade = await root.ok('GET', '/mis/trade?ccy=USD');
    expect(Number(trade.byIncoterm[0].revenue)).toBeCloseTo(10000 + 440000 / 80.8, 2);
    const fin = await root.ok('GET', '/mis/financial?ccy=USD');
    const gbp = fin.byCurrency.find((c: { currency: string }) => c.currency === 'GBP');
    expect(gbp.invoiced).toBe('4000.00'); // the billed figure itself is never converted
    expect(Number(gbp.invoiced_rpt)).toBeCloseTo(440000 / 80.8, 2);
  });

  it('keeps the live-rate screens on the newest rate after loading history', async () => {
    stubEcbHistory();
    await root.ok('GET', '/mis/overview');
    const rates = await root.ok('GET', '/masters/currencies?pageSize=5');
    expect(rates.total).toBeGreaterThan(0);
    const all = (await root.get('/exchange-rates')).body;
    const usd = all.rates.find((x: { code: string }) => x.code === 'USD');
    // history rows (2026-09) must not replace a newer stored rate as "latest"
    if (usd) expect(usd.rateDate >= '2026-09-08').toBe(true);
  });
});
