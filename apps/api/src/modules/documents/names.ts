/** A document may name its buyer from the customer list or as text typed on that document only. */
import { sql } from 'drizzle-orm';
import { docTables, masterTables } from '../../db/schema/index.js';

/** For queries on proforma_invoices left-joined to customers. */
export function orderBuyer() {
  return sql<string | null>`coalesce(${masterTables.customers.name}, ${docTables.proformaInvoices.header.buyerIdText})`;
}

/** The same as a sub-query, for queries that do not join customers. */
export function orderBuyerLookup() {
  const pi = docTables.proformaInvoices.header;
  return sql<string | null>`coalesce((select c.name from customers c where c.id = ${pi.buyerId}), ${pi.buyerIdText})`;
}
