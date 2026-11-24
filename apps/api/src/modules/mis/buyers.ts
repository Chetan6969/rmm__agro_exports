/**
 * Buyer & Market Intelligence — per-buyer revenue, volume, outstanding, average order value and
 * repeat behaviour, from commercial invoices + payments. Country per buyer is the destination they
 * ship to most (buyers have no country field of their own).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, fx, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];

export async function misBuyers(tx: Tx, f: MisFilter) {
  const w = docWhere('ci', 'commercial_invoice_lines', f);
  const ciFx = fx('ci', f.ccy);

  const buyers = await rows(
    tx,
    sql`
      select cust.id,
             cust.name,
             sum(ci.invoice_total * ${ciFx})::text as revenue_rpt,
             sum((ci.invoice_total - coalesce(pp.paid, 0)) * ${ciFx})::text as outstanding_rpt,
             count(distinct ci.id)::int as invoices,
             coalesce(sum(lv.vol), 0)::text as volume_mt,
             to_char(max(ci.document_date), 'YYYY-MM-DD') as last_order,
             to_char(min(ci.document_date), 'YYYY-MM-DD') as first_order
      from commercial_invoices ci
      join customers cust on cust.id = ci.buyer_id
      left join (select commercial_invoice_id, sum(amount) as paid from payments where deleted_at is null group by commercial_invoice_id) pp
             on pp.commercial_invoice_id = ci.id
      left join lateral (select sum(l.quantity_mt) as vol from commercial_invoice_lines l where l.document_id = ci.id) lv on true
      where ${w}
      group by cust.id, cust.name
      order by sum(ci.invoice_total * ${ciFx}) desc`,
  );

  // top destination country per buyer (by revenue), for context
  const topCountry = await rows(
    tx,
    sql`
      select buyer_id, country from (
        select ci.buyer_id,
               coalesce(co.name, 'Unspecified') as country,
               row_number() over (partition by ci.buyer_id order by sum(ci.invoice_total * ${ciFx}) desc) as rn
        from commercial_invoices ci
        left join countries co on co.id = ci.destination_country_id
        where ${w}
        group by ci.buyer_id, co.name
      ) t where rn = 1`,
  );
  const countryOf = new Map(topCountry.map((r) => [String(r.buyer_id), String(r.country)]));
  for (const b of buyers) b.country = countryOf.get(String(b.id)) ?? '';

  return { buyers };
}
