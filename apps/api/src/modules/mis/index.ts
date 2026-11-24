/**
 * MIS analytics routes. Every endpoint is company-scoped (RLS inside inTenantTx), gated on
 * `mis.dashboard:view`, and takes the shared MisFilter from the query string.
 */
import type { FastifyInstance } from 'fastify';
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

/** Register a GET endpoint that runs `fn` with the parsed filter inside a tenant tx, gated on mis.dashboard:view. */
function misGet(app: FastifyInstance, path: string, fn: (tx: Tx, f: MisFilter, ctx: RequestContext, q: Record<string, unknown>) => Promise<unknown>) {
  app.get(path, async (req) => {
    const ctx = requireCtx(req);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const f = parseMisFilter(q);
    return inTenantTx(ctx, (tx) => {
      requireCompany(ctx);
      requirePerm(ctx, 'mis.dashboard', 'view');
      return fn(tx, f, ctx, q);
    });
  });
}

export async function misRoutes(app: FastifyInstance) {
  misGet(app, '/mis/filter-options', (tx) => misFilterOptions(tx));
  misGet(app, '/mis/overview', (tx, f) => misOverview(tx, f));
  misGet(app, '/mis/trade', (tx, f) => misTrade(tx, f));
  misGet(app, '/mis/buyers', (tx, f) => misBuyers(tx, f));
  misGet(app, '/mis/orders', (tx, f) => misOrders(tx, f));
  misGet(app, '/mis/logistics', (tx, f) => misLogistics(tx, f));
  misGet(app, '/mis/financial', (tx, f) => misFinancial(tx, f));
  misGet(app, '/mis/products', (tx, f) => misProducts(tx, f));
  misGet(app, '/mis/documentation', (tx, f) => misDocumentation(tx, f));
  misGet(app, '/mis/reports', (tx, f, _ctx, q) => misReport(tx, String(q.report ?? 'invoices'), f));
}
