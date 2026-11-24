/**
 * Live market reference rates for the currencies master.
 *
 * Sources (both free, no API key):
 *  - ECB: European Central Bank reference rates via Frankfurter (open source, MIT).
 *    Official, published once per working day around 16:00 CET. Used whenever the ECB
 *    publishes the currency.
 *  - fawazahmed0: open exchange-api (CC0), daily market data covering 200+ currencies.
 *    Used only for currencies the ECB does not publish (e.g. AED, SAR): their rate per US
 *    dollar comes from this market data and is combined with the ECB's INR per US dollar,
 *    so pegged currencies stay exactly on their peg relative to the USD row. If the ECB is
 *    unreachable, the market data's own INR per US dollar is used instead.
 *
 * These are market reference rates for information and pricing. Customs (shipping bills)
 * use the CBIC-notified rate, which is a separate, fortnightly figure.
 */
import { CURRENCY_CODE_RE, type LiveRate, type LiveRatesResponse } from '@rmm/shared';
import { and, desc, eq, gte, inArray, isNull, max } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { exchangeRates, masterTables } from '../db/schema/index.js';
import { requireCtx, requirePerm } from '../core/context.js';

const ECB_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';
/** Market data quoted per US dollar (primary CDN, then the project's mirror). */
const MARKET_USD_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
];
const TIMEOUT_MS = 8000;
/** After a failed attempt, wait this long before trying the providers again (unless forced). */
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
const SCALE = 6;

// ------------------------------------------------------------------ exact decimal arithmetic
/** JSON numbers → plain decimal text without exponent notation. */
export function decimalText(v: number | string): string {
  if (typeof v === 'string') return v.trim();
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid rate ${v}`);
  const s = String(v);
  return /e/i.test(s) ? v.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : s;
}

function toUnits(text: string): { units: bigint; scale: number } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`Invalid decimal "${text}"`);
  const fraction = m[2] ?? '';
  return { units: BigInt(m[1] + fraction), scale: fraction.length };
}

function fromUnits(units: bigint, scale: number): string {
  const s = units.toString().padStart(scale + 1, '0');
  return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
}

/** a ÷ b rounded half-up to `scale` decimals, exactly (no floating point). */
export function divide(a: string, b: string, scale = SCALE): string {
  const x = toUnits(a);
  const y = toUnits(b);
  if (y.units === 0n) throw new Error('Division by zero');
  // a/b = (x.units / 10^x.scale) / (y.units / 10^y.scale); shift so the quotient has `scale` decimals.
  const numerator = x.units * 10n ** BigInt(scale + y.scale);
  const denominator = y.units * 10n ** BigInt(x.scale);
  const q = (numerator * 2n + denominator) / (denominator * 2n);
  return fromUnits(q, scale);
}

/** Rounds a decimal string half-up to `scale` decimals. */
export const round = (text: string, scale = SCALE) => divide(text, '1', scale);

// ------------------------------------------------------------------ providers
const ecbSchema = z.object({ base: z.literal('EUR'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rates: z.record(z.string(), z.number().positive()) });

interface Fetched {
  code: string;
  rateToInr: string;
  rateDate: string;
  source: LiveRate['source'];
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

interface EcbResult {
  rates: Fetched[];
  /** Exact INR per US dollar, used to price currencies the ECB does not publish. */
  inrPerUsd: { value: string; date: string } | null;
}

/** INR per unit for every requested currency the ECB publishes (EUR crosses, computed exactly). */
async function fromEcb(codes: string[]): Promise<EcbResult> {
  const body = ecbSchema.parse(await getJson(ECB_URL));
  const inrPerEur = body.rates.INR;
  if (!inrPerEur) throw new Error('ECB response has no INR rate');
  const inr = decimalText(inrPerEur);
  const rates: Fetched[] = [];
  for (const code of codes) {
    if (code === 'EUR') rates.push({ code, rateToInr: round(inr), rateDate: body.date, source: 'ECB' });
    else if (body.rates[code]) rates.push({ code, rateToInr: divide(inr, decimalText(body.rates[code])), rateDate: body.date, source: 'ECB' });
  }
  const usd = body.rates.USD;
  // Extra precision for the cross, so the final 6-decimal rounding happens only once.
  return { rates, inrPerUsd: usd ? { value: divide(inr, decimalText(usd), 12), date: body.date } : null };
}

const marketSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  usd: z.record(z.string(), z.number()),
});

/**
 * INR per unit for currencies the ECB does not publish:
 * (INR per USD) / (currency per USD). INR per USD comes from the ECB when available.
 */
async function fromMarket(codes: string[], ecbInrPerUsd: EcbResult['inrPerUsd']): Promise<{ rates: Fetched[]; problems: string[] }> {
  let body: z.infer<typeof marketSchema> | null = null;
  let lastError: unknown;
  for (const url of MARKET_USD_URLS) {
    try {
      body = marketSchema.parse(await getJson(url));
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!body) {
    return { rates: [], problems: [`market data unavailable (${lastError instanceof Error ? lastError.message : lastError})`] };
  }

  const marketInr = body.usd.inr;
  const inrPerUsd = ecbInrPerUsd ?? (marketInr && marketInr > 0 ? { value: decimalText(marketInr), date: body.date } : null);
  if (!inrPerUsd) return { rates: [], problems: ['market data has no INR rate'] };

  const rates: Fetched[] = [];
  const problems: string[] = [];
  for (const code of codes) {
    const perUsd = body.usd[code.toLowerCase()];
    if (!perUsd || perUsd <= 0) {
      problems.push(`${code}: no public rate available`);
      continue;
    }
    rates.push({
      code,
      rateToInr: divide(inrPerUsd.value, decimalText(perUsd)),
      // As of the older of the two inputs, so the age shown is never optimistic.
      rateDate: inrPerUsd.date < body.date ? inrPerUsd.date : body.date,
      source: ecbInrPerUsd ? 'ECB+fawazahmed0' : 'fawazahmed0',
    });
  }
  return { rates, problems };
}

// ------------------------------------------------------------------ refresh + read
// ------------------------------------------------------------------ ₹ per US dollar history (MIS in USD)
const seriesSchema = z.object({
  base: z.literal('EUR'),
  rates: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.record(z.string(), z.number().positive())),
});
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
let historyInflight: Promise<string | null> | null = null;
let historyFailedAt = 0;

/** True when stored ECB ₹/USD rates leave no gap longer than 6 days from `from` (minus a week) up to today. */
async function usdHistoryCovered(from: string): Promise<boolean> {
  const since = isoDay(Date.parse(from) - 7 * DAY);
  const rows = await db()
    .select({ d: exchangeRates.rateDate })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.currencyCode, 'USD'), eq(exchangeRates.source, 'ECB'), gte(exchangeRates.rateDate, since)))
    .orderBy(exchangeRates.rateDate);
  const days = [...new Set(rows.map((r) => r.d))].map((d) => Date.parse(d));
  if (!days.length || days[0] > Date.parse(from)) return false;
  for (let i = 1; i < days.length; i++) if (days[i] - days[i - 1] > 6 * DAY) return false;
  return Date.now() - days[days.length - 1] <= 6 * DAY;
}

/**
 * Makes sure the ECB ₹-per-US-dollar reference rate is stored for every working day from
 * `from` until today, fetching the missing history once (ECB time series via Frankfurter).
 * Historical rows are stamped with their publication day, so the live-rate screens keep
 * showing the newest rate. Returns a problem text when the history could not be loaded.
 */
export function ensureUsdHistory(from: string): Promise<string | null> {
  historyInflight ??= (async () => {
    try {
      if (await usdHistoryCovered(from)) return null;
      if (Date.now() - historyFailedAt < RETRY_AFTER_FAILURE_MS) return 'ECB rate history is temporarily unavailable';
      const start = isoDay(Date.parse(from) - 7 * DAY);
      const body = seriesSchema.parse(await getJson(`https://api.frankfurter.dev/v1/${start}..${isoDay(Date.now())}?base=EUR&symbols=INR,USD`));
      const values = Object.entries(body.rates)
        .filter(([, r]) => r.INR && r.USD)
        .map(([date, r]) => ({
          currencyCode: 'USD',
          rateToInr: divide(decimalText(r.INR!), decimalText(r.USD!)),
          rateDate: date,
          source: 'ECB',
          // ECB publishes around 16:00 CET; never later than now
          fetchedAt: new Date(Math.min(Date.parse(`${date}T15:00:00Z`), Date.now())),
        }));
      if (values.length) await db().insert(exchangeRates).values(values).onConflictDoNothing();
      historyFailedAt = 0;
      return null;
    } catch (e) {
      historyFailedAt = Date.now();
      return `ECB rate history could not be loaded (${e instanceof Error ? e.message : e})`;
    } finally {
      historyInflight = null;
    }
  })();
  return historyInflight;
}

let inflight: Promise<string[]> | null = null;
let lastFailureAt = 0;
/** Problems from the latest refresh, reported until a later refresh succeeds. */
let lastProblems: string[] = [];

async function activeCodes(): Promise<string[]> {
  const t = masterTables.currencies;
  const rows = await db()
    .select({ code: t.code })
    .from(t)
    .where(and(isNull(t.deletedAt), eq(t.isActive, true)));
  return rows.map((r) => String(r.code).toUpperCase()).filter((c) => CURRENCY_CODE_RE.test(c) && c !== 'INR');
}

/** Fetches every active currency and stores the results. Returns problems (empty when all succeeded). */
async function refresh(log: FastifyBaseLogger): Promise<string[]> {
  const codes = await activeCodes();
  if (!codes.length) return [];
  const problems: string[] = [];
  const results: Fetched[] = [];

  let ecbInrPerUsd: EcbResult['inrPerUsd'] = null;
  try {
    const ecb = await fromEcb(codes);
    results.push(...ecb.rates);
    ecbInrPerUsd = ecb.inrPerUsd;
  } catch (e) {
    problems.push(`ECB rates unavailable (${e instanceof Error ? e.message : e})`);
  }
  const missing = codes.filter((c) => !results.some((r) => r.code === c));
  if (missing.length) {
    const market = await fromMarket(missing, ecbInrPerUsd);
    results.push(...market.rates);
    problems.push(...market.problems);
  }

  const now = new Date();
  for (const r of results) {
    await db()
      .insert(exchangeRates)
      .values({ currencyCode: r.code, rateToInr: r.rateToInr, rateDate: r.rateDate, source: r.source, fetchedAt: now })
      .onConflictDoUpdate({
        target: [exchangeRates.currencyCode, exchangeRates.source, exchangeRates.rateDate],
        set: { rateToInr: r.rateToInr, fetchedAt: now },
      });
  }
  if (problems.length) log.warn({ problems }, 'exchange rate refresh incomplete');
  return problems;
}

/** One refresh at a time for the whole process; concurrent callers share it. */
function refreshOnce(log: FastifyBaseLogger): Promise<string[]> {
  inflight ??= refresh(log)
    .catch((e: unknown) => [e instanceof Error ? e.message : String(e)])
    .then((problems) => {
      lastFailureAt = problems.length ? Date.now() : 0;
      lastProblems = problems;
      return problems;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function lastCheckedAt(): Promise<Date | null> {
  const [row] = await db().select({ at: max(exchangeRates.fetchedAt) }).from(exchangeRates);
  return row?.at ? new Date(row.at) : null;
}

async function latestRates(codes: string[]): Promise<LiveRate[]> {
  if (!codes.length) return [];
  // Newest confirmation per currency (DISTINCT ON keeps the first row of each code in this order).
  const rows = await db()
    .selectDistinctOn([exchangeRates.currencyCode])
    .from(exchangeRates)
    .where(inArray(exchangeRates.currencyCode, codes))
    .orderBy(exchangeRates.currencyCode, desc(exchangeRates.fetchedAt), desc(exchangeRates.rateDate));
  return rows.map((r) => ({
    code: r.currencyCode,
    rateToInr: r.rateToInr,
    rateDate: r.rateDate,
    source: r.source as LiveRate['source'],
    fetchedAt: r.fetchedAt.toISOString(),
  }));
}

async function buildResponse(problems: string[]): Promise<LiveRatesResponse> {
  const codes = await activeCodes();
  const [rates, checkedAt] = await Promise.all([latestRates(codes), lastCheckedAt()]);
  const response: LiveRatesResponse = { rates, checkedAt: checkedAt?.toISOString() ?? null, refreshMinutes: config.exchangeRateRefreshMinutes };
  if (problems.length) {
    response.problem = {
      message: rates.length ? 'Could not refresh every live rate; showing the last known rates' : 'Live rates could not be loaded',
      hint:
        'The ERP server needs internet access to api.frankfurter.dev and cdn.jsdelivr.net. Check the server\'s internet connection or firewall, then press Refresh. ' +
        `Details: ${problems.slice(0, 3).join('; ')}`,
    };
  }
  return response;
}

export async function exchangeRateRoutes(app: FastifyInstance) {
  app.get('/exchange-rates', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'master.currencies', 'view');
    const checked = await lastCheckedAt();
    const stale = !checked || Date.now() - checked.getTime() > config.exchangeRateRefreshMinutes * 60_000;
    const coolingDown = Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS;
    return buildResponse(stale && !coolingDown ? await refreshOnce(req.log) : lastProblems);
  });

  app.post('/exchange-rates/refresh', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'master.currencies', 'view');
    return buildResponse(await refreshOnce(req.log));
  });
}
