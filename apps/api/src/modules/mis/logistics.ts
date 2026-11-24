/**
 * Shipment & Logistics MIS — shipments (lots) with market, pipeline status, planned charges and the
 * linked ocean bill (vessel / BL / discharge port). Target vs actual ship date comes from the
 * shipment's target date vs the OBL's B/L date. Shipments are scoped through their proforma invoice.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];
const one = async (tx: Tx, q: SQL) => (await rows(tx, q))[0] ?? {};

export async function misLogistics(tx: Tx, f: MisFilter) {
  const w = docWhere('pi', 'proforma_invoice_lines', f);
  const base = sql`from shipments s join proforma_invoices pi on pi.id = s.proforma_invoice_id where s.deleted_at is null and ${w}`;

  const summary = await one(
    tx,
    sql`select count(*)::int as total,
                count(*) filter (where s.status in ('PLANNED','IN_PROGRESS'))::int as active,
                count(*) filter (where s.status = 'SHIPPED')::int as shipped,
                count(*) filter (where s.status = 'CANCELLED')::int as cancelled,
                coalesce(sum(s.quantity_mt), 0)::text as qty_mt,
                coalesce(sum(s.container_count), 0)::int as containers
         ${base}`,
  );

  const byStatus = await rows(tx, sql`select s.status, count(*)::int as count, coalesce(sum(s.quantity_mt),0)::text as qty_mt ${base} group by s.status order by count desc`);
  const byMarket = await rows(tx, sql`select s.market, count(*)::int as count, coalesce(sum(s.quantity_mt),0)::text as qty_mt ${base} group by s.market order by count desc`);

  // planned charges (₹) by head
  const charges = await rows(
    tx,
    sql`select coalesce(nullif(sc.label, ''), 'Other') as head,
                coalesce(sum(sc.amount), 0)::text as amount
         from shipment_charges sc
         join shipments s on s.id = sc.shipment_id
         join proforma_invoices pi on pi.id = s.proforma_invoice_id
         where s.deleted_at is null and ${w}
         group by sc.label order by sum(sc.amount) desc`,
  );

  // on-time analysis: BL date vs target ship date
  const timing = await one(
    tx,
    sql`select count(*) filter (where ob.bl_date is not null and s.target_ship_date is not null and ob.bl_date <= s.target_ship_date)::int as on_time,
                count(*) filter (where ob.bl_date is not null and s.target_ship_date is not null and ob.bl_date > s.target_ship_date)::int as late,
                count(*) filter (where ob.bl_date is null)::int as in_pipeline
         from shipments s
         join proforma_invoices pi on pi.id = s.proforma_invoice_id
         left join ocean_bills ob on ob.id = s.ocean_bill_id
         where s.deleted_at is null and s.status <> 'CANCELLED' and ${w}`,
  );

  const shipments = await rows(
    tx,
    sql`select s.id,
                pi.document_number as order_no,
                coalesce(cust.name, '-') as buyer,
                s.market,
                s.status,
                s.quantity_mt::text as qty_mt,
                s.container_count as containers,
                to_char(s.target_ship_date, 'YYYY-MM-DD') as target_date,
                ob.vessel_name,
                ob.bl_number,
                to_char(ob.bl_date, 'YYYY-MM-DD') as bl_date,
                coalesce(po.name, '') as discharge_port
         from shipments s
         join proforma_invoices pi on pi.id = s.proforma_invoice_id
         left join customers cust on cust.id = pi.buyer_id
         left join ocean_bills ob on ob.id = s.ocean_bill_id
         left join ports po on po.id = ob.port_of_discharge_id
         where s.deleted_at is null and ${w}
         order by s.target_ship_date desc nulls last, s.created_at desc
         limit 100`,
  );

  return { summary, byStatus, byMarket, charges, timing, shipments };
}
