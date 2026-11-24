/**
 * Documentation & Compliance — per-shipment document completeness (production order, commercial
 * invoice, ocean bill, certificates) and manual pipeline steps done, plus a certificate count by
 * template. All derived from existing links; a missing document shows as "missing", never faked.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];
const one = async (tx: Tx, q: SQL) => (await rows(tx, q))[0] ?? {};

export async function misDocumentation(tx: Tx, f: MisFilter) {
  const wPi = docWhere('pi', 'proforma_invoice_lines', f);
  const wCi = docWhere('ci', 'commercial_invoice_lines', f);
  const base = sql`from shipments s join proforma_invoices pi on pi.id = s.proforma_invoice_id where s.deleted_at is null and ${wPi}`;

  const summary = await one(
    tx,
    sql`select count(*)::int as total,
                count(*) filter (where s.production_order_id is not null)::int as with_po,
                count(*) filter (where s.commercial_invoice_id is not null)::int as with_ci,
                count(*) filter (where s.ocean_bill_id is not null)::int as with_obl
         ${base}`,
  );

  const certsByTemplate = await rows(
    tx,
    sql`select coalesce(ct.title, 'Certificate') as name, count(*)::int as count
         from certificates c
         join commercial_invoices ci on ci.id = c.commercial_invoice_id
         left join certificate_templates ct on ct.id = c.certificate_template_id
         where c.deleted_at is null and ${wCi}
         group by ct.title order by count desc`,
  );

  const checklist = await rows(
    tx,
    sql`select s.id,
                pi.document_number as order_no,
                coalesce(cust.name, '-') as buyer,
                s.market,
                s.status,
                (s.production_order_id is not null) as po,
                (s.commercial_invoice_id is not null) as ci,
                (s.ocean_bill_id is not null) as obl,
                coalesce(cc.cert_count, 0)::int as certs,
                coalesce(st.done_count, 0)::int as stages_done
         from shipments s
         join proforma_invoices pi on pi.id = s.proforma_invoice_id
         left join customers cust on cust.id = pi.buyer_id
         left join lateral (
           select count(*) as cert_count from certificates c
           where c.deleted_at is null and (c.commercial_invoice_id = s.commercial_invoice_id or c.ocean_bill_id = s.ocean_bill_id)
         ) cc on true
         left join lateral (select count(*) as done_count from shipment_stages ss where ss.shipment_id = s.id and ss.done = true) st on true
         where s.deleted_at is null and ${wPi}
         order by s.target_ship_date desc nulls last limit 100`,
  );

  return { summary, certsByTemplate, checklist };
}
