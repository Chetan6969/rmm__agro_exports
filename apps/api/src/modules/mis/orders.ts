/**
 * Export Order & Contract MIS — proforma invoices as orders/contracts: status mix, contract value
 * vs executed value (linked commercial invoices), fulfilment rate. Values are in the reporting currency
 * (see `fx` in filter.ts).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, fx, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];
const one = async (tx: Tx, q: SQL) => (await rows(tx, q))[0] ?? {};

export async function misOrders(tx: Tx, f: MisFilter) {
  const w = docWhere('pi', 'proforma_invoice_lines', f);
  const wAll = docWhere('pi', 'proforma_invoice_lines', { ...f, status: null });
  const piFx = fx('pi', f.ccy);
  const ciFx = fx('ci', f.ccy);

  const byStatus = await rows(
    tx,
    sql`select pi.status,
                count(*)::int as count,
                coalesce(sum(pi.grand_total * ${piFx}), 0)::text as value_rpt
         from proforma_invoices pi where ${wAll} group by pi.status order by count desc`,
  );

  const summary = await one(
    tx,
    sql`select count(*)::int as total,
                count(*) filter (where pi.status = 'CONFIRMED')::int as confirmed,
                count(*) filter (where pi.status = 'FULFILLED')::int as fulfilled,
                count(*) filter (where pi.status = 'CANCELLED')::int as cancelled,
                coalesce(sum(pi.grand_total * ${piFx}) filter (where pi.status <> 'CANCELLED'), 0)::text as contract_value_rpt,
                coalesce(sum(pi.total_quantity_mt) filter (where pi.status <> 'CANCELLED'), 0)::text as contract_qty_mt
         from proforma_invoices pi where ${wAll}`,
  );

  // executed value = commercial invoices linked to these PIs
  const executed = await one(
    tx,
    sql`select coalesce(sum(ci.invoice_total * ${ciFx}), 0)::text as executed_value_rpt,
                coalesce(sum(cl.vol), 0)::text as executed_qty_mt
         from commercial_invoices ci
         join proforma_invoices pi on pi.id = ci.proforma_invoice_id
         left join lateral (select sum(l.quantity_mt) as vol from commercial_invoice_lines l where l.document_id = ci.id) cl on true
         where ci.deleted_at is null and ci.status <> 'CANCELLED' and ${w}`,
  );

  const orders = await rows(
    tx,
    sql`select pi.id,
                pi.document_number as number,
                to_char(pi.document_date, 'YYYY-MM-DD') as date,
                coalesce(cust.name, '-') as buyer,
                coalesce(cur.code, '') as currency,
                pi.status,
                pi.grand_total::text as value,
                (pi.grand_total * ${piFx})::text as value_rpt,
                pi.total_quantity_mt::text as qty_mt,
                coalesce(ex.executed_rpt, 0)::text as executed_rpt
         from proforma_invoices pi
         left join customers cust on cust.id = pi.buyer_id
         left join currencies cur on cur.id = pi.currency_id
         left join lateral (
           select sum(ci.invoice_total * ${ciFx}) as executed_rpt
           from commercial_invoices ci where ci.proforma_invoice_id = pi.id and ci.deleted_at is null and ci.status <> 'CANCELLED'
         ) ex on true
         where ${w}
         order by pi.document_date desc, pi.document_number desc
         limit 100`,
  );

  return { byStatus, summary: { ...summary, ...executed }, orders };
}
