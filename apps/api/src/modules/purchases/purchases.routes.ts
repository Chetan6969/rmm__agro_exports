/**
 *  /purchase-invoices   supplier bills (list, one, create, change, delete → recycle bin)
 *  POST /vendor-pos     a purchase order typed in by hand (packaging, paddy / rice, services…)
 */
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm } from '../../core/context.js';
import { notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables, masterTables, purchaseInvoices } from '../../db/schema/index.js';
import { createPurchaseInvoice, createPurchaseOrder, paymentStatus, updatePurchaseInvoice } from './purchases.service.js';

const MOD = 'sales.purchaseInvoices';

export async function listPurchaseInvoices(tx: Tx, q: { search?: string; category?: string; status?: string; orderId?: string; id?: string }) {
  const su = masterTables.suppliers;
  const pi = docTables.proformaInvoices.header;
  const t = purchaseInvoices;
  const conds: SQL[] = [isNull(t.deletedAt)];
  if (q.id) conds.push(eq(t.id, q.id));
  if (q.category) conds.push(eq(t.category, q.category));
  if (q.orderId) conds.push(eq(t.proformaInvoiceId, q.orderId));
  if (q.status === 'UNPAID') conds.push(sql`${t.paidAmount} <= 0`);
  if (q.status === 'PART') conds.push(sql`${t.paidAmount} > 0 and ${t.paidAmount} < ${t.totalAmount}`);
  if (q.status === 'PAID') conds.push(sql`${t.paidAmount} >= ${t.totalAmount}`);
  if (q.search?.trim()) {
    const s = `%${q.search.trim().replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(or(ilike(t.invoiceNo, s), ilike(su.name, s), ilike(t.description, s), ilike(pi.documentNumber, s), sql`exists (select 1 from vendor_pos v where v.id = ${t.vendorPoId} and v.number ilike ${s})`)!);
  }
  const rows = await tx
    .select({
      id: t.id,
      invoiceNo: t.invoiceNo,
      invoiceDate: t.invoiceDate,
      supplierId: t.supplierId,
      supplierName: su.name,
      vendorPoId: t.vendorPoId,
      vendorPoNumber: sql<string | null>`(select v.number from vendor_pos v where v.id = ${t.vendorPoId})`,
      orderId: t.proformaInvoiceId,
      orderNumber: pi.documentNumber,
      orderSource: pi.orderSource,
      buyer: sql<string | null>`(select c.name from customers c where c.id = ${pi.buyerId})`,
      shipmentId: t.shipmentId,
      lotNo: sql<number | null>`(select s.lot_no from shipments s where s.id = ${t.shipmentId})`,
      category: t.category,
      description: t.description,
      quantity: t.quantity,
      unit: t.unit,
      taxableAmount: t.taxableAmount,
      gstAmount: t.gstAmount,
      totalAmount: t.totalAmount,
      paidAmount: t.paidAmount,
      dueDate: t.dueDate,
      fileId: t.fileId,
      inboxItemId: t.inboxItemId,
      notes: t.notes,
      version: t.version,
    })
    .from(t)
    .leftJoin(su, eq(su.id, t.supplierId))
    .leftJoin(pi, eq(pi.id, t.proformaInvoiceId))
    .where(and(...conds))
    .orderBy(desc(t.invoiceDate), desc(t.createdAt))
    .limit(2000);
  return rows.map((r) => ({ ...r, paymentStatus: paymentStatus(r.totalAmount, r.paidAmount) }));
}

export async function purchaseRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { search?: string; category?: string; status?: string; orderId?: string } }>('/purchase-invoices', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    const { id: _ignored, ...q } = req.query as Record<string, string>;
    return inTenantTx(ctx, (tx) => listPurchaseInvoices(tx, q));
  });

  app.get<{ Params: { id: string } }>('/purchase-invoices/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    const id = z.uuid().parse(req.params.id);
    return inTenantTx(ctx, async (tx) => {
      const [row] = await listPurchaseInvoices(tx, { id });
      if (!row) throw notFound('Purchase invoice not found', 'It may have been deleted (see the recycle bin).');
      return row;
    });
  });

  app.post('/purchase-invoices', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'create');
    requireCompany(ctx);
    const row = await inTenantTx(ctx, (tx) => createPurchaseInvoice(tx, ctx, req.body));
    return reply.status(201).send(row);
  });

  app.put<{ Params: { id: string } }>('/purchase-invoices/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    requireCompany(ctx);
    const id = z.uuid().parse(req.params.id);
    return inTenantTx(ctx, (tx) => updatePurchaseInvoice(tx, ctx, id, req.body));
  });

  app.delete<{ Params: { id: string } }>('/purchase-invoices/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'delete');
    requireCompany(ctx);
    const id = z.uuid().parse(req.params.id);
    const reason = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {}).reason ?? null;
    return inTenantTx(ctx, async (tx) => {
      const [row] = await tx.select().from(purchaseInvoices).where(and(eq(purchaseInvoices.id, id), isNull(purchaseInvoices.deletedAt)));
      if (!row) throw notFound('Purchase invoice not found');
      await tx.update(purchaseInvoices).set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason }).where(eq(purchaseInvoices.id, id));
      await audit(tx, ctx, { entity: 'purchaseInvoices', recordId: id, action: 'delete', meta: { invoiceNo: row.invoiceNo, reason } });
      return { ok: true };
    });
  });

  app.post('/vendor-pos', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'sales.vendorPos', 'create');
    requireCompany(ctx);
    const po = await inTenantTx(ctx, (tx) => createPurchaseOrder(tx, ctx, req.body));
    return reply.status(201).send(po);
  });
}

/** Total billed against each purchase order. */
export async function billedByPo(tx: Tx, poIds: string[]) {
  if (!poIds.length) return new Map<string, string>();
  const rows = await tx
    .select({ po: purchaseInvoices.vendorPoId, total: sql<string>`sum(${purchaseInvoices.totalAmount})::text` })
    .from(purchaseInvoices)
    .where(and(inArray(purchaseInvoices.vendorPoId, poIds), isNull(purchaseInvoices.deletedAt)))
    .groupBy(purchaseInvoices.vendorPoId);
  return new Map(rows.map((r) => [r.po as string, r.total]));
}
