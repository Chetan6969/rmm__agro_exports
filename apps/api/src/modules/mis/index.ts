/**
 * MIS analytics routes. Every endpoint is company-scoped (RLS inside inTenantTx), gated on
 * `mis.dashboard:view`, and takes the shared MisFilter from the query string.
 */
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ensureUsdHistory } from '../exchange-rates.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import type { Tx } from '../../db/client.js';
import { misBuyers } from './buyers.js';
import { misDocumentation } from './documentation.js';
import { misFilterOptions, parseMisFilter, type MisFilter } from './filter.js';
import { misFinancial } from './financial.js';
import { misLogistics } from './logistics.js';
import { misOrders } from './orders.js';
import { misOverview } from './overview.js';
import { misProducts } from './products.js';
import { misReport } from './reports.js';
import { misTrade } from './trade.js';

/** How money on MIS screens was converted, shown under the filter bar. */
export interface MisFx {
  currency: 'USD' | 'INR';
  basis: string;
  /** Set when the ECB rate history could not be loaded (older documents then use the nearest stored rate). */
  problem?: { message: string; hint: string };
}

/** For USD reporting: make sure the ECB ₹/$ rate exists for every day since the company's first document. */
async function prepareFx(ctx: RequestContext, f: MisFilter): Promise<MisFx> {
  if (f.ccy === 'INR') {
    return { currency: 'INR', basis: 'Each document converted at its own exchange rate (the rate it was billed at).' };
  }
  const [first] = (await inTenantTx(ctx, (tx) =>
    tx.execute(sql`select to_char(min(d), 'YYYY-MM-DD') as d from (
      select min(document_date) as d from commercial_invoices where deleted_at is null
      union all select min(document_date) from proforma_invoices where deleted_at is null) x`),
  )) as unknown as { d: string | null }[];
  const problem = first?.d ? await ensureUsdHistory(first.d) : null;
  return {
    currency: 'USD',
    basis: 'US-dollar documents as billed; other currencies converted through ₹ at the ECB ₹/$ reference rate of each document date.',
    ...(problem
      ? {
          problem: {
            message: 'Some older dollar conversions use the nearest available rate',
            hint: `The ERP server needs internet access to api.frankfurter.dev to load ECB rate history; it retries automatically. Details: ${problem}`,
          },
        }
      : {}),
  };
}

/** Register a GET endpoint that runs `fn` with the parsed filter inside a tenant tx, gated on mis.dashboard:view. */
function misGet(
  app: FastifyInstance,
  path: string,
  fn: (tx: Tx, f: MisFilter, ctx: RequestContext, q: Record<string, unknown>) => Promise<unknown>,
  opts: { money?: boolean } = { money: true },
) {
  app.get(path, async (req) => {
    const ctx = requireCtx(req);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const f = parseMisFilter(q);
    requireCompany(ctx);
    requirePerm(ctx, 'mis.dashboard', 'view');
    const fxInfo = opts.money ? await prepareFx(ctx, f) : null;
    const result = await inTenantTx(ctx, (tx) => fn(tx, f, ctx, q));
    return fxInfo ? { ...(result as object), fx: fxInfo } : result;
  });
}

export async function misRoutes(app: FastifyInstance) {
  misGet(app, '/mis/filter-options', (tx) => misFilterOptions(tx), { money: false });
  misGet(app, '/mis/overview', (tx, f) => misOverview(tx, f));
  misGet(app, '/mis/trade', (tx, f) => misTrade(tx, f));
  misGet(app, '/mis/buyers', (tx, f) => misBuyers(tx, f));
  misGet(app, '/mis/orders', (tx, f) => misOrders(tx, f));
  misGet(app, '/mis/logistics', (tx, f) => misLogistics(tx, f));
  misGet(app, '/mis/financial', (tx, f) => misFinancial(tx, f));
  misGet(app, '/mis/products', (tx, f) => misProducts(tx, f));
  misGet(app, '/mis/documentation', (tx, f) => misDocumentation(tx, f));
  // reports list stored values in each document's own currency (with a currency column)
  misGet(app, '/mis/reports', (tx, f, _ctx, q) => misReport(tx, String(q.report ?? 'invoices'), f), { money: false });
}
