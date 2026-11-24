/**
 * Product Analytics — volume (MT) and INR revenue by variety, processing type, grade, crop year and
 * individual product, from commercial-invoice lines joined to the product master. No quality /
 * inspection metrics (those records aren't captured).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { docWhere, type MisFilter } from './filter.js';

type Row = Record<string, unknown>;
const rows = async (tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as Row[];

const dim = (tx: Tx, w: SQL, expr: SQL) =>
  rows(
    tx,
    sql`select ${expr} as label,
                coalesce(sum(l.quantity_mt), 0)::text as volume_mt,
                coalesce(sum(l.amount * ci.exchange_rate), 0)::text as revenue,
                coalesce(sum(l.no_of_bags), 0)::int as bags
         from commercial_invoice_lines l
         join commercial_invoices ci on ci.id = l.document_id
         left join products p on p.id = l.product_id
         where ${w}
         group by ${expr} order by sum(l.quantity_mt) desc nulls last`,
  );

export async function misProducts(tx: Tx, f: MisFilter) {
  const w = docWhere('ci', 'commercial_invoice_lines', f);
  const [byVariety, byProcessing, byGrade, byCropYear, byProduct] = await Promise.all([
    dim(tx, w, sql`coalesce(p.variety, 'Unspecified')`),
    dim(tx, w, sql`coalesce(nullif(p.rice_type, ''), 'Unspecified')`),
    dim(tx, w, sql`coalesce(nullif(p.grade, ''), 'Unspecified')`),
    dim(tx, w, sql`coalesce(nullif(l.crop_year, ''), nullif(p.crop_year, ''), 'Unspecified')`),
    dim(tx, w, sql`coalesce(p.name, 'Unspecified')`),
  ]);
  return { byVariety, byProcessing, byGrade, byCropYear, byProduct };
}
