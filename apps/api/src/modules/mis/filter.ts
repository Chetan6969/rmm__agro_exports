/**
 * Shared MIS analytics filter. Every MIS aggregation takes the same `MisFilter` and applies it
 * server-side, so the GlobalFilterBar on the web drives every panel consistently. The filter maps
 * only onto fields the platform actually records (dates, buyer, destination country, currency,
 * product / variety, document status) — nothing is invented.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';

export interface MisFilter {
  from: string | null; // YYYY-MM-DD (inclusive) on document_date
  to: string | null; // YYYY-MM-DD (inclusive)
  buyerId: string | null;
  destinationCountryId: string | null;
  productId: string | null;
  variety: string | null; // products.variety (Basmati / Non-Basmati)
  currencyId: string | null;
  status: string | null; // document status; when null, cancelled docs are excluded
  /** Reporting currency for every money figure (default USD). */
  ccy: MisCurrency;
}

export type MisCurrency = 'USD' | 'INR';

/**
 * ₹ per US dollar on a date: the ECB reference rate published on or before it; before the
 * stored history starts, the earliest stored rate; with no history at all, the USD master rate.
 */
export const usdInrOn = (date: SQL) => sql`coalesce(
  (select er.rate_to_inr from exchange_rates er where er.currency_code = 'USD' and er.source = 'ECB' and er.rate_date <= ${date} order by er.rate_date desc limit 1),
  (select er.rate_to_inr from exchange_rates er where er.currency_code = 'USD' and er.source = 'ECB' order by er.rate_date asc limit 1),
  (select cu.exchange_rate from currencies cu where cu.code = 'USD' and cu.deleted_at is null limit 1))`;

/**
 * Factor that turns an amount in a document's own currency into the reporting currency.
 *  ₹: the document's own exchange rate (the rate it was billed at).
 *  $: 1 for US-dollar documents (exact billed figures); other currencies go through ₹ with the
 *     document's rate, then into dollars at the ECB ₹/$ rate of the document's date.
 */
export function fx(alias: string, ccy: MisCurrency): SQL {
  const a = sql.raw(alias);
  if (ccy === 'INR') return sql`${a}.exchange_rate`;
  return sql`(case when (select cu.code from currencies cu where cu.id = ${a}.currency_id) = 'USD' then 1
                   else ${a}.exchange_rate / nullif(${usdInrOn(sql`${a}.document_date`)}, 0) end)`;
}

/** Factor for amounts recorded in rupees (e.g. shipment charges) dated `date`. */
export const fxFromInr = (date: SQL, ccy: MisCurrency): SQL => (ccy === 'INR' ? sql`1` : sql`(1 / nullif(${usdInrOn(date)}, 0))`);

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};
const isDate = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function parseMisFilter(q: Record<string, unknown>): MisFilter {
  return {
    from: isDate(str(q.from)),
    to: isDate(str(q.to)),
    buyerId: str(q.buyerId),
    destinationCountryId: str(q.destinationCountryId),
    productId: str(q.productId),
    variety: str(q.variety),
    currencyId: str(q.currencyId),
    status: str(q.status),
    ccy: str(q.ccy)?.toUpperCase() === 'INR' ? 'INR' : 'USD',
  };
}

/**
 * WHERE fragment for a document header (alias `ci`/`pi`/…) with its lines table, applying the
 * filter. `opts.parties` controls buyer/destination/currency matching (header-only docs skip some).
 */
export function docWhere(
  alias: string,
  linesTable: string | null,
  f: MisFilter,
  opts: { parties?: boolean } = {},
): SQL {
  const parties = opts.parties ?? true;
  const a = sql.raw(alias);
  const c: SQL[] = [sql`${a}.deleted_at is null`];
  if (f.status) c.push(sql`${a}.status = ${f.status}`);
  else c.push(sql`${a}.status <> 'CANCELLED'`);
  if (f.from) c.push(sql`${a}.document_date >= ${f.from}`);
  if (f.to) c.push(sql`${a}.document_date <= ${f.to}`);
  if (parties) {
    if (f.buyerId) c.push(sql`${a}.buyer_id = ${f.buyerId}`);
    if (f.destinationCountryId) c.push(sql`${a}.destination_country_id = ${f.destinationCountryId}`);
    if (f.currencyId) c.push(sql`${a}.currency_id = ${f.currencyId}`);
  }
  if (linesTable && (f.productId || f.variety)) {
    const lt = sql.raw(linesTable);
    if (f.productId) c.push(sql`exists (select 1 from ${lt} l where l.document_id = ${a}.id and l.product_id = ${f.productId})`);
    if (f.variety)
      c.push(sql`exists (select 1 from ${lt} l join products p on p.id = l.product_id where l.document_id = ${a}.id and p.variety = ${f.variety})`);
  }
  return sql.join(c, sql` and `);
}

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];

/** Choices for the GlobalFilterBar — only buyers / countries / currencies / products that appear on real invoices. */
export async function misFilterOptions(tx: Tx) {
  const [buyers, countries, currencies, products] = await Promise.all([
    rows(
      tx,
      sql`select distinct c.id, c.name from customers c
          join commercial_invoices ci on ci.buyer_id = c.id and ci.deleted_at is null
          where c.deleted_at is null order by c.name`,
    ),
    rows(
      tx,
      sql`select distinct co.id, co.name from countries co
          join commercial_invoices ci on ci.destination_country_id = co.id and ci.deleted_at is null
          where co.deleted_at is null order by co.name`,
    ),
    rows(
      tx,
      sql`select distinct cu.id, cu.code from currencies cu
          join commercial_invoices ci on ci.currency_id = cu.id and ci.deleted_at is null
          where cu.deleted_at is null order by cu.code`,
    ),
    rows(
      tx,
      sql`select distinct p.id, p.name, p.variety from products p
          join commercial_invoice_lines l on l.product_id = p.id
          join commercial_invoices ci on ci.id = l.document_id and ci.deleted_at is null
          where p.deleted_at is null order by p.name`,
    ),
  ]);
  return { buyers, countries, currencies, products };
}
