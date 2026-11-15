import type { LiveRate } from '@rmm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { decimalText, divide } from '../src/modules/exchange-rates.js';
import { Client, createSuperAdmin, makeApp } from './helpers.js';

// Expected values below were computed independently with Python's decimal module (ROUND_HALF_UP).
const ECB_BODY = { amount: 1, base: 'EUR', date: '2026-11-13', rates: { INR: 104.1575, USD: 1.1052, GBP: 0.8356 } };
const MARKET_BODY = { date: '2026-11-14', usd: { usd: 1, inr: 94.1, eur: 0.9048, gbp: 0.7563, aed: 3.6725, sar: 3.75 } };

type Provider = 'ok' | 'down';
function stubProviders(ecb: Provider, market: Provider) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const state = url.includes('frankfurter') ? ecb : market;
    if (state === 'down') return new Response('unavailable', { status: 503 });
    return Response.json(url.includes('frankfurter') ? ECB_BODY : MARKET_BODY);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const byCode = (body: { rates: LiveRate[] }): Record<string, LiveRate> => Object.fromEntries(body.rates.map((r) => [r.code, r]));

let app: FastifyInstance;
let root: Client;

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('rates-root');
  root = new Client(app);
  await root.login('rates-root');
  for (const [code, name, rate] of [
    ['INR', 'Indian Rupee', 1],
    ['USD', 'US Dollar', 84],
    ['EUR', 'Euro', 91],
    ['GBP', 'Pound Sterling', 108],
    ['AED', 'UAE Dirham', 22.9],
    ['SAR', 'Saudi Riyal', 22.4],
  ] as const) {
    const res = await root.post('/masters/currencies', { code, name, exchangeRate: rate });
    // Another test file may already have created it; either way it must exist.
    expect([200, 201, 409]).toContain(res.status);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('exact decimal arithmetic', () => {
  it('divides exactly with half-up rounding', () => {
    expect(divide('104.1575', '1.1052')).toBe('94.243123');
    expect(divide('1', '3')).toBe('0.333333');
    expect(divide('2', '3')).toBe('0.666667');
    expect(divide('0.0000005', '1')).toBe('0.000001');
    expect(divide('91.75', '1', 2)).toBe('91.75');
  });

  it('turns JSON numbers into plain decimal text', () => {
    expect(decimalText(0.8356)).toBe('0.8356');
    expect(decimalText(1e-7)).toBe('0.0000001');
    expect(() => decimalText(0)).toThrow();
  });
});

describe('live exchange rates', () => {
  it('prices ECB currencies from ECB crosses and pegged currencies through the ECB dollar', async () => {
    const fetchMock = stubProviders('ok', 'ok');
    const res = await root.post('/exchange-rates/refresh');
    expect(res.status).toBe(200);
    expect(res.body.problem).toBeUndefined();
    const r = byCode(res.body);
    expect(r.INR).toBeUndefined();
    expect(r.USD).toMatchObject({ rateToInr: '94.243123', rateDate: '2026-11-13', source: 'ECB' });
    expect(r.EUR).toMatchObject({ rateToInr: '104.157500', source: 'ECB' });
    expect(r.GBP).toMatchObject({ rateToInr: '124.649952', source: 'ECB' });
    // AED and SAR keep their exact US dollar pegs (3.6725, 3.75) relative to the USD row,
    // dated by the older of the two inputs.
    expect(r.AED).toMatchObject({ rateToInr: '25.661844', rateDate: '2026-11-13', source: 'ECB+fawazahmed0' });
    expect(r.SAR).toMatchObject({ rateToInr: '25.131500', rateDate: '2026-11-13', source: 'ECB+fawazahmed0' });
    expect(res.body.checkedAt).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A fresh result is served from the database without calling the providers again.
    fetchMock.mockClear();
    const again = await root.get('/exchange-rates');
    expect(byCode(again.body).USD.rateToInr).toBe('94.243123');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to market data when the ECB is down and says so', async () => {
    stubProviders('down', 'ok');
    const res = await root.post('/exchange-rates/refresh');
    const r = byCode(res.body);
    expect(r.USD).toMatchObject({ rateToInr: '94.100000', rateDate: '2026-11-14', source: 'fawazahmed0' });
    expect(r.EUR).toMatchObject({ rateToInr: '104.000884', source: 'fawazahmed0' });
    expect(r.AED).toMatchObject({ rateToInr: '25.622873', source: 'fawazahmed0' });
    expect(res.body.problem.message).toMatch(/last known/);
    expect(res.body.problem.hint).toMatch(/api\.frankfurter\.dev/);
  });

  it('keeps the last known rates with a fix-it hint when every provider is unreachable', async () => {
    stubProviders('down', 'down');
    const res = await root.post('/exchange-rates/refresh');
    expect(res.status).toBe(200);
    expect(byCode(res.body).USD.rateToInr).toBe('94.100000');
    expect(res.body.problem.hint).toMatch(/internet access/);

    // The warning stays visible on later reads during the retry cooldown, without new provider calls.
    const fetchMock = stubProviders('ok', 'ok');
    const later = await root.get('/exchange-rates');
    expect(later.body.problem).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires currency view permission', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/exchange-rates' });
    expect(anon.statusCode).toBe(401);
  });
});
