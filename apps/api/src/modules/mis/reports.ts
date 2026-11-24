/**
 * Custom Reports — a small set of tabular datasets built from the real tables, all honouring the
 * global MIS filter. The web page renders the chosen dataset and exports it to CSV. No synthetic
 * columns: every field comes straight from a stored value.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];

export interface Column {
  key: string;
  label: string;
  num?: boolean;
}

export const REPORTS: { key: string; label: string; columns: Column[] }[] = [
  {
    key: 'invoices',
    label: 'Commercial invoices',
    columns: [
      { key: 'number', label: 'Invoice' },
      { key: 'date', label: 'Date' },
      { key: 'buyer', label: 'Buyer' },
      { key: 'country', label: 'Destination' },
      { key: 'currency', label: 'Ccy' },
      { key: 'incoterm', label: 'Incoterm' },
      { key: 'qty_mt', label: 'Qty MT', num: true },
      { key: 'total', label: 'Total', num: true },
      { key: 'received', label: 'Received', num: true },
      { key: 'pending', label: 'Pending', num: true },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    key: 'lines',
    label: 'Invoice line items',
    columns: [
      { key: 'number', label: 'Invoice' },
      { key: 'date', label: 'Date' },
      { key: 'buyer', label: 'Buyer' },
      { key: 'product', label: 'Product' },
      { key: 'variety', label: 'Variety' },
      { key: 'hs_code', label: 'HS code' },
      { key: 'bags', label: 'Bags', num: true },
      { key: 'qty_mt', label: 'Qty MT', num: true },
      { key: 'rate', label: 'Rate/MT', num: true },
      { key: 'amount', label: 'Amount', num: true },
      { key: 'currency', label: 'Ccy' },
    ],
  },
  {
    key: 'orders',
    label: 'Orders (proforma)',
    columns: [
      { key: 'number', label: 'Order' },
      { key: 'date', label: 'Date' },
      { key: 'buyer', label: 'Buyer' },
      { key: 'country', label: 'Destination' },
      { key: 'currency', label: 'Ccy' },
      { key: 'qty_mt', label: 'Qty MT', num: true },
      { key: 'total', label: 'Value', num: true },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    key: 'payments',
    label: 'Receipts',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'number', label: 'Invoice' },
      { key: 'buyer', label: 'Buyer' },
      { key: 'amount', label: 'Amount', num: true },
      { key: 'currency', label: 'Ccy' },
      { key: 'mode', label: 'Mode' },
      { key: 'reference', label: 'Reference' },
    ],
  },
  {
    key: 'shipments',
    label: 'Shipments',
    columns: [
      { key: 'order_no', label: 'Order' },
      { key: 'buyer', label: 'Buyer' },
      { key: 'market', label: 'Market' },
      { key: 'status', label: 'Status' },
      { key: 'qty_mt', label: 'Qty MT', num: true },
      { key: 'containers', label: 'Ctrs', num: true },
      { key: 'target_date', label: 'Target' },
      { key: 'vessel_name', label: 'Vessel' },
      { key: 'bl_number', label: 'B/L no.' },
    ],
  },
];

export async function misReport(tx: Tx, report: string, f: MisFilter): Promise<{ report: string; columns: Column[]; rows: Row[] }> {
  const def = REPORTS.find((r) => r.key === report) ?? REPORTS[0];
  const wCi = docWhere('ci', 'commercial_invoice_lines', f);
  const wPi = docWhere('pi', 'proforma_invoice_lines', f);
  let data: Row[] = [];

  if (def.key === 'invoices') {
    data = await rows(
      tx,
      sql`select ci.document_number as number, to_char(ci.document_date,'YYYY-MM-DD') as date,
                  coalesce(cust.name,'-') as buyer, coalesce(co.name,'') as country, coalesce(cur.code,'') as currency,
                  coalesce(ci.incoterm,'') as incoterm,
                  coalesce((select sum(l.quantity_mt) from commercial_invoice_lines l where l.document_id=ci.id),0)::text as qty_mt,
                  ci.invoice_total::text as total, coalesce(pp.paid,0)::text as received,
                  (ci.invoice_total-coalesce(pp.paid,0))::text as pending, ci.status
           from commercial_invoices ci
           left join customers cust on cust.id=ci.buyer_id
           left join countries co on co.id=ci.destination_country_id
           left join currencies cur on cur.id=ci.currency_id
           left join (select commercial_invoice_id, sum(amount) as paid from payments where deleted_at is null group by commercial_invoice_id) pp on pp.commercial_invoice_id=ci.id
           where ${wCi} order by ci.document_date desc, ci.document_number desc limit 2000`,
    );
  } else if (def.key === 'lines') {
    data = await rows(
      tx,
      sql`select ci.document_number as number, to_char(ci.document_date,'YYYY-MM-DD') as date,
                  coalesce(cust.name,'-') as buyer, coalesce(p.name,'') as product, coalesce(p.variety,'') as variety,
                  coalesce(l.hs_code,'') as hs_code, coalesce(l.no_of_bags,0)::text as bags,
                  l.quantity_mt::text as qty_mt, l.rate_per_mt::text as rate, l.amount::text as amount, coalesce(cur.code,'') as currency
           from commercial_invoice_lines l
           join commercial_invoices ci on ci.id=l.document_id
           left join customers cust on cust.id=ci.buyer_id
           left join products p on p.id=l.product_id
           left join currencies cur on cur.id=ci.currency_id
           where ${wCi} order by ci.document_date desc, ci.document_number desc, l.position limit 3000`,
    );
  } else if (def.key === 'orders') {
    data = await rows(
      tx,
      sql`select pi.document_number as number, to_char(pi.document_date,'YYYY-MM-DD') as date,
                  coalesce(cust.name,'-') as buyer, coalesce(co.name,'') as country, coalesce(cur.code,'') as currency,
                  pi.total_quantity_mt::text as qty_mt, pi.grand_total::text as total, pi.status
           from proforma_invoices pi
           left join customers cust on cust.id=pi.buyer_id
           left join countries co on co.id=pi.destination_country_id
           left join currencies cur on cur.id=pi.currency_id
           where ${wPi} order by pi.document_date desc, pi.document_number desc limit 2000`,
    );
  } else if (def.key === 'payments') {
    data = await rows(
      tx,
      sql`select to_char(p.payment_date,'YYYY-MM-DD') as date, ci.document_number as number,
                  coalesce(cust.name,'-') as buyer, p.amount::text as amount, coalesce(cur.code,'') as currency,
                  coalesce(p.mode,'') as mode, coalesce(p.reference,'') as reference
           from payments p
           join commercial_invoices ci on ci.id=p.commercial_invoice_id
           left join customers cust on cust.id=ci.buyer_id
           left join currencies cur on cur.id=ci.currency_id
           where p.deleted_at is null and ${wCi} order by p.payment_date desc limit 2000`,
    );
  } else if (def.key === 'shipments') {
    data = await rows(
      tx,
      sql`select pi.document_number as order_no, coalesce(cust.name,'-') as buyer, s.market, s.status,
                  s.quantity_mt::text as qty_mt, s.container_count::text as containers,
                  to_char(s.target_ship_date,'YYYY-MM-DD') as target_date,
                  coalesce(ob.vessel_name,'') as vessel_name, coalesce(ob.bl_number,'') as bl_number
           from shipments s
           join proforma_invoices pi on pi.id=s.proforma_invoice_id
           left join customers cust on cust.id=pi.buyer_id
           left join ocean_bills ob on ob.id=s.ocean_bill_id
           where s.deleted_at is null and ${wPi} order by s.target_ship_date desc nulls last limit 2000`,
    );
  }

  return { report: def.key, columns: def.columns, rows: data };
}
