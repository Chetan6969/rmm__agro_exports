/**
 * Financial & Forex MIS — revenue/received/pending by currency (and in the reporting currency), recorded sale-
 * side charges (freight / insurance / shipping / discount), LC tracking from the invoices' LC number,
 * and market reference rates from the exchange_rates table. Procurement cost is not recorded, so this
 * is the sale side only — never presented as full profit.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, fx, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];
const one = async (tx: Tx, q: SQL) => (await rows(tx, q))[0] ?? {};

export async function misFinancial(tx: Tx, f: MisFilter) {
  const w = docWhere('ci', 'commercial_invoice_lines', f);
  const ciFx = fx('ci', f.ccy);

  const byCurrency = await rows(
    tx,
    sql`select coalesce(cur.code, '-') as currency,
                count(*)::int as invoices,
                coalesce(sum(ci.invoice_total), 0)::text as invoiced,
                coalesce(sum(pp.paid), 0)::text as received,
                (coalesce(sum(ci.invoice_total), 0) - coalesce(sum(pp.paid), 0))::text as pending,
                coalesce(sum(ci.invoice_total * ${ciFx}), 0)::text as invoiced_rpt,
                round(avg(ci.exchange_rate), 4)::text as avg_rate
         from commercial_invoices ci
         left join currencies cur on cur.id = ci.currency_id
         left join (select commercial_invoice_id, sum(amount) as paid from payments where deleted_at is null group by commercial_invoice_id) pp
                on pp.commercial_invoice_id = ci.id
         where ${w}
         group by cur.code order by sum(ci.invoice_total * ${ciFx}) desc`,
  );

  const totals = await one(
    tx,
    sql`select coalesce(sum(ci.invoice_total * ${ciFx}), 0)::text as revenue_rpt,
                coalesce(sum(coalesce(ci.fob_amount, 0) * ${ciFx}), 0)::text as fob_rpt,
                coalesce(sum(coalesce(ci.ocean_freight_amount, 0) * ${ciFx}), 0)::text as freight_rpt,
                coalesce(sum(coalesce(ci.insurance_amount, 0) * ${ciFx}), 0)::text as insurance_rpt,
                coalesce(sum(coalesce(ci.total_shipping_charge, 0) * ${ciFx}), 0)::text as shipping_rpt,
                coalesce(sum(coalesce(ci.discount_amount, 0) * ${ciFx}), 0)::text as discount_rpt
         from commercial_invoices ci where ${w}`,
  );
  const received = await one(
    tx,
    sql`select coalesce(sum(p.amount * ${ciFx}), 0)::text as received_rpt
         from payments p join commercial_invoices ci on ci.id = p.commercial_invoice_id
         where p.deleted_at is null and ${w}`,
  );

  const lc = await rows(
    tx,
    sql`select ci.id,
                ci.document_number as number,
                ci.lc_number,
                to_char(ci.lc_date, 'YYYY-MM-DD') as lc_date,
                coalesce(cust.name, ci.buyer_id_text, '-') as buyer,
                coalesce(cur.code, '') as currency,
                ci.invoice_total::text as value
         from commercial_invoices ci
         left join customers cust on cust.id = ci.buyer_id
         left join currencies cur on cur.id = ci.currency_id
         where ${w} and coalesce(ci.lc_number, '') <> ''
         order by ci.lc_date desc nulls last limit 50`,
  );

  // latest market reference rate per currency (not company-scoped — public reference data)
  const marketRates = await rows(
    tx,
    sql`select distinct on (currency_code) currency_code, rate_to_inr::text as rate_to_inr, rate_date, source
         from exchange_rates order by currency_code, fetched_at desc`,
  );

  return { byCurrency, totals: { ...totals, ...received }, lc, marketRates };
}
