/**
 * Export Overview — headline KPIs + charts for the MIS landing page. Revenue is normalised to INR
 * using each document's own transaction exchange rate (so mixed-currency invoices add up); a
 * per-currency receivables breakdown is kept alongside for the real figures. Everything respects the
 * shared MisFilter.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];
const one = async (tx: Tx, q: SQL) => (await rows(tx, q))[0] ?? {};

export async function misOverview(tx: Tx, f: MisFilter) {
  const ciW = docWhere('ci', 'commercial_invoice_lines', f);
  const piW = docWhere('pi', 'proforma_invoice_lines', f);
  // order-status donut ignores the status filter so the whole mix is visible
  const piAll = docWhere('pi', 'proforma_invoice_lines', { ...f, status: null });

  // ---- headline KPIs (INR normalised) ----
  const kpi = await one(
    tx,
    sql`
      select
        coalesce(sum(ci.invoice_total * ci.exchange_rate), 0)::text as revenue_inr,
        count(*)::int as invoices,
        count(distinct ci.buyer_id)::int as buyers,
        count(distinct ci.destination_country_id)::int as countries
      from commercial_invoices ci
      where ${ciW}`,
  );
  const volume = await one(
    tx,
    sql`select coalesce(sum(l.quantity_mt), 0)::text as volume_mt
        from commercial_invoice_lines l join commercial_invoices ci on ci.id = l.document_id
        where ${ciW}`,
  );
  const received = await one(
    tx,
    sql`select coalesce(sum(p.amount * ci.exchange_rate), 0)::text as received_inr
        from payments p join commercial_invoices ci on ci.id = p.commercial_invoice_id
        where p.deleted_at is null and ${ciW}`,
  );
  const orders = await one(
    tx,
    sql`select count(*)::int as orders,
                count(*) filter (where pi.status = 'CONFIRMED')::int as active_contracts
         from proforma_invoices pi where ${piW}`,
  );
  const ships = await one(
    tx,
    sql`select count(*)::int as total,
                count(*) filter (where s.status in ('PLANNED','IN_PROGRESS'))::int as pending,
                count(*) filter (where s.status = 'SHIPPED')::int as completed
         from shipments s join proforma_invoices pi on pi.id = s.proforma_invoice_id
         where s.deleted_at is null and ${piW}`,
  );

  // ---- monthly revenue & received (INR), last 12 months in range ----
  const monthly = await rows(
    tx,
    sql`
      with m as (
        select to_char(ci.document_date, 'YYYY-MM') as month,
               sum(ci.invoice_total * ci.exchange_rate) as revenue
        from commercial_invoices ci where ${ciW} group by 1
      ),
      r as (
        select to_char(p.payment_date, 'YYYY-MM') as month,
               sum(p.amount * ci.exchange_rate) as received
        from payments p join commercial_invoices ci on ci.id = p.commercial_invoice_id
        where p.deleted_at is null and ${ciW} group by 1
      )
      select coalesce(m.month, r.month) as month,
             coalesce(m.revenue, 0)::text as revenue,
             coalesce(r.received, 0)::text as received
      from m full outer join r on m.month = r.month
      order by month desc limit 12`,
  );

  // ---- revenue by destination country (INR) ----
  const byCountry = await rows(
    tx,
    sql`
      select coalesce(co.name, 'Unspecified') as country,
             sum(ci.invoice_total * ci.exchange_rate)::text as revenue,
             count(*)::int as invoices
      from commercial_invoices ci
      left join countries co on co.id = ci.destination_country_id
      where ${ciW}
      group by co.name order by sum(ci.invoice_total * ci.exchange_rate) desc`,
  );

  // ---- product / variety distribution (volume MT + INR revenue from lines) ----
  const byVariety = await rows(
    tx,
    sql`
      select coalesce(p.variety, 'Unspecified') as variety,
             sum(l.quantity_mt)::text as volume_mt,
             sum(l.amount * ci.exchange_rate)::text as revenue
      from commercial_invoice_lines l
      join commercial_invoices ci on ci.id = l.document_id
      left join products p on p.id = l.product_id
      where ${ciW}
      group by p.variety order by sum(l.quantity_mt) desc`,
  );

  // ---- order-status donut (proforma invoices) ----
  const orderStatus = await rows(
    tx,
    sql`select pi.status, count(*)::int as count from proforma_invoices pi where ${piAll} group by pi.status order by count desc`,
  );

  // ---- per-currency receivables (real figures, not converted) ----
  const receivables = await rows(
    tx,
    sql`
      select coalesce(cur.code, '-') as currency,
             count(*)::int as count,
             coalesce(sum(ci.invoice_total), 0)::text as invoiced,
             coalesce(sum(pp.paid), 0)::text as received,
             (coalesce(sum(ci.invoice_total), 0) - coalesce(sum(pp.paid), 0))::text as pending
      from commercial_invoices ci
      left join currencies cur on cur.id = ci.currency_id
      left join (select commercial_invoice_id, sum(amount) as paid from payments where deleted_at is null group by commercial_invoice_id) pp
             on pp.commercial_invoice_id = ci.id
      where ${ciW}
      group by cur.code order by pending desc`,
  );

  const monthlyAsc = monthly.reverse();
  const revenueInr = Number((kpi.revenue_inr as string) ?? 0);
  const volumeMt = Number((volume.volume_mt as string) ?? 0);
  // month-over-month growth on the last two populated months
  let growthPct: number | null = null;
  if (monthlyAsc.length >= 2) {
    const prev = Number((monthlyAsc[monthlyAsc.length - 2] as Row).revenue);
    const last = Number((monthlyAsc[monthlyAsc.length - 1] as Row).revenue);
    if (prev > 0) growthPct = ((last - prev) / prev) * 100;
  }

  return {
    kpis: {
      revenueInr: String(revenueInr),
      receivedInr: String(received.received_inr ?? 0),
      volumeMt: String(volumeMt),
      avgPricePerMt: String(volumeMt > 0 ? revenueInr / volumeMt : 0),
      invoices: kpi.invoices ?? 0,
      activeBuyers: kpi.buyers ?? 0,
      countries: kpi.countries ?? 0,
      orders: orders.orders ?? 0,
      activeContracts: orders.active_contracts ?? 0,
      shipmentsPending: ships.pending ?? 0,
      shipmentsCompleted: ships.completed ?? 0,
      shipmentsTotal: ships.total ?? 0,
      growthPct,
    },
    monthly: monthlyAsc,
    byCountry,
    byVariety,
    orderStatus,
    receivables,
  };
}
