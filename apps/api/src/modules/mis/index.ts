/**
 * MIS analytics routes. Every endpoint is company-scoped (RLS inside inTenantTx), gated on
 * `mis.dashboard:view`, and takes the shared MisFilter from the query string.
 */
import type { FastifyInstance } from 'fastify';
import { inTenantTx, requireCompany, requireCtx, requirePerm } from '../../core/context.js';
import { misFilterOptions, parseMisFilter } from './filter.js';
import { misOverview } from './overview.js';

export async function misRoutes(app: FastifyInstance) {
  app.get('/mis/filter-options', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => {
      requireCompany(ctx);
      requirePerm(ctx, 'mis.dashboard', 'view');
      return misFilterOptions(tx);
    });
  });

  app.get('/mis/overview', async (req) => {
    const ctx = requireCtx(req);
    const f = parseMisFilter((req.query ?? {}) as Record<string, unknown>);
    return inTenantTx(ctx, (tx) => {
      requireCompany(ctx);
      requirePerm(ctx, 'mis.dashboard', 'view');
      return misOverview(tx, f);
    });
  });
}
