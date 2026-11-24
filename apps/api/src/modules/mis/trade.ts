/**
 * Global Trade Analytics — export performance by destination country, discharge port and incoterm.
 * Country analytics use the document's destination country (buyers carry no country field). All
 * revenue is in the reporting currency (see `fx` in filter.ts).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, fx, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];

export async function misTrade(tx: Tx, f: MisFilter) {
  const w = docWhere('ci', 'commercial_invoice_lines', f);
  const ciFx = fx('ci', f.ccy);

  const byCountry = await rows(
    tx,
    sql`
      select coalesce(co.name, 'Unspecified') as country,
             ci.destination_country_id as id,
             coalesce(co.region, '') as region,
             sum(ci.invoice_total * ${ciFx})::text as revenue,
             count(distinct ci.id)::int as invoices,
             count(distinct ci.buyer_id)::int as buyers,
             coalesce(sum(lv.vol), 0)::text as volume_mt
      from commercial_invoices ci
      left join countries co on co.id = ci.destination_country_id
      left join lateral (select sum(l.quantity_mt) as vol from commercial_invoice_lines l where l.document_id = ci.id) lv on true
      where ${w}
      group by co.name, ci.destination_country_id, co.region
      order by sum(ci.invoice_total * ${ciFx}) desc`,
  );

  const byPort = await rows(
    tx,
    sql`
      select coalesce(po.name, 'Unspecified') as port,
             coalesce(co.name, '') as country,
             sum(ci.invoice_total * ${ciFx})::text as revenue,
             count(*)::int as invoices
      from commercial_invoices ci
      left join ports po on po.id = ci.port_of_discharge_id
      left join countries co on co.id = po.country_id
      where ${w}
      group by po.name, co.name
      order by sum(ci.invoice_total * ${ciFx}) desc`,
  );

  const byIncoterm = await rows(
    tx,
    sql`
      select coalesce(nullif(ci.incoterm, ''), '-') as incoterm,
             count(*)::int as count,
             sum(ci.invoice_total * ${ciFx})::text as revenue
      from commercial_invoices ci
      where ${w}
      group by ci.incoterm
      order by count desc`,
  );

  return { byCountry, byPort, byIncoterm };
}
