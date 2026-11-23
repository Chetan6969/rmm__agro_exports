/**
 * Receipts against commercial invoices. Received = Σ payments; pending = invoice total − received.
 */
import { add, isDecimal, isPositive, round, sub } from '@rmm/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables } from '../../db/schema/documents.js';
import { masterTables } from '../../db/schema/masters.js';
import { payments } from '../../db/schema/payments.js';

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const paymentSchema = z.object({
  commercialInvoiceId: z.uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a payment date'),
  amount: z.string().refine((v) => isDecimal(v) && isPositive(v), 'Enter an amount above 0'),
  mode: z.string().max(64).optional().nullable(),
  reference: z.string().max(128).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

async function invoiceSummary(tx: Tx, invoiceId: string) {
  const ci = docTables.commercialInvoices.header;
  const cur = masterTables.currencies;
  const [inv] = (await tx
    .select({ id: ci.id, number: ci.documentNumber, total: ci.invoiceTotal, currency: cur.code })
    .from(ci)
    .leftJoin(cur, eq(cur.id, ci.currencyId))
    .where(and(eq(ci.id, invoiceId), isNull(ci.deletedAt)))) as { id: string; number: string; total: string; currency: string | null }[];
  return inv;
}

export async function listPayments(tx: Tx, ctx: RequestContext, invoiceId: string) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.payments', 'view');
  const inv = await invoiceSummary(tx, invoiceId);
  if (!inv) throw notFound('Invoice not found');
  const rows = (await tx
    .select()
    .from(payments)
    .where(and(eq(payments.commercialInvoiceId, invoiceId), isNull(payments.deletedAt)))
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt))) as Record<string, unknown>[];
  const received = add(rows.map((r) => str(r.amount)), 2);
  const invoiceTotal = round(str(inv.total), 2);
  return { invoiceNumber: inv.number, currency: inv.currency ?? '', invoiceTotal, received, pending: sub(invoiceTotal, received, 2), rows };
}

export async function createPayment(tx: Tx, ctx: RequestContext, body: unknown) {
  const companyId = requireCompany(ctx);
  requirePerm(ctx, 'sales.payments', 'create');
  const p = paymentSchema.parse(body);
  const inv = await invoiceSummary(tx, p.commercialInvoiceId);
  if (!inv) throw badRequest('That commercial invoice is not available', { fields: { commercialInvoiceId: 'Not found' } });
  const [row] = (await tx
    .insert(payments)
    .values({ ...p, mode: p.mode ?? null, reference: p.reference ?? null, note: p.note ?? null, companyId, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning()) as Record<string, unknown>[];
  await audit(tx, ctx, { entity: 'payments', recordId: row.id as string, action: 'create', after: row, meta: { invoice: inv.number, amount: p.amount } });
  return listPayments(tx, ctx, p.commercialInvoiceId);
}

export async function deletePayment(tx: Tx, ctx: RequestContext, id: string) {
  requireCompany(ctx);
  requirePerm(ctx, 'sales.payments', 'delete');
  const [before] = (await tx.select().from(payments).where(and(eq(payments.id, id), isNull(payments.deletedAt)))) as Record<string, unknown>[];
  if (!before) throw notFound('Payment not found');
  await tx.update(payments).set({ deletedAt: new Date(), deletedBy: ctx.userId }).where(eq(payments.id, id));
  await audit(tx, ctx, { entity: 'payments', recordId: id, action: 'delete', before });
  return listPayments(tx, ctx, before.commercialInvoiceId as string);
}

export async function paymentsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { invoice?: string } }>('/payments', async (req) => {
    const ctx = requireCtx(req);
    const invoice = z.uuid().parse(req.query.invoice);
    return inTenantTx(ctx, (tx) => listPayments(tx, ctx, invoice));
  });
  app.post('/payments', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => createPayment(tx, ctx, req.body));
  });
  app.delete<{ Params: { id: string } }>('/payments/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => deletePayment(tx, ctx, req.params.id));
  });
}
