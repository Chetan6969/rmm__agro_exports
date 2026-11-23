/**
 * MIS summary: orders by status, receivables (invoiced / received / pending) per currency,
 * monthly trend and the top pending invoices. Company-scoped (RLS applies inside inTenantTx).
 */
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../core/context.js';
import type { Tx } from '../db/client.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Row[];

export async function misSummary(tx: Tx, ctx: RequestContext) {
  requireCompany(ctx);
  requirePerm(ctx, 'mis.dashboard', 'view');

  const byStatus = (table: string) =>
    rows(tx, sql`select status, count(*)::int as count from ${sql.raw(table)} where deleted_at is null group by status`);

  const [proforma, production, commercial] = await Promise.all([byStatus('proforma_invoices'), byStatus('production_orders'), byStatus('commercial_invoices')]);

  // receivables per currency
  const receivables = await rows(
    tx,
    sql`
      select coalesce(cur.code, '-') as currency,
             count(*)::int as count,
             coalesce(sum(ci.invoice_total), 0)::text as invoiced,
             coalesce(sum(p.paid), 0)::text as received,
             (coalesce(sum(ci.invoice_total), 0) - coalesce(sum(p.paid), 0))::text as pending
      from commercial_invoices ci
      left join currencies cur on cur.id = ci.currency_id
      left join (select commercial_invoice_id, sum(amount) as paid from payments where deleted_at is null group by commercial_invoice_id) p
             on p.commercial_invoice_id = ci.id
      where ci.deleted_at is null and ci.status <> 'CANCELLED'
      group by cur.code
      order by pending desc`,
  );

  // monthly invoiced value + received (last 12 months)
  const monthly = await rows(
    tx,
    sql`
      with m as (
        select to_char(document_date, 'YYYY-MM') as month, sum(invoice_total)::text as invoiced
        from commercial_invoices where deleted_at is null and status <> 'CANCELLED' group by 1
      ),
      r as (
        select to_char(payment_date, 'YYYY-MM') as month, sum(amount)::text as received
        from payments where deleted_at is null group by 1
      )
      select coalesce(m.month, r.month) as month, coalesce(m.invoiced, '0') as invoiced, coalesce(r.received, '0') as received
      from m full outer join r on m.month = r.month
      order by month desc limit 12`,
  );

  // top pending invoices
  const pending = await rows(
    tx,
    sql`
      select ci.id, ci.document_number as number, ci.document_date as date,
             coalesce(cust.name, '-') as buyer, coalesce(cur.code, '') as currency,
             ci.invoice_total::text as total,
             coalesce(p.paid, 0)::text as received,
             (ci.invoice_total - coalesce(p.paid, 0))::text as pending
      from commercial_invoices ci
      left join customers cust on cust.id = ci.buyer_id
      left join currencies cur on cur.id = ci.currency_id
      left join (select commercial_invoice_id, sum(amount) as paid from payments where deleted_at is null group by commercial_invoice_id) p
             on p.commercial_invoice_id = ci.id
      where ci.deleted_at is null and ci.status <> 'CANCELLED' and (ci.invoice_total - coalesce(p.paid, 0)) > 0.01
      order by pending desc limit 12`,
  );

  return { orders: { proforma, production, commercial }, receivables, monthly: monthly.reverse(), pending };
}

export async function misRoutes(app: FastifyInstance) {
  app.get('/mis/summary', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => misSummary(tx, ctx));
  });
}
