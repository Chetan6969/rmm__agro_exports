/**
 * /intake — the document inbox. Any user with "Document inbox" rights drops documents here;
 * they are read on this server (offline OCR), recognised and matched, then reviewed and confirmed.
 */
import { INTAKE_KINDS, intakeKind, PURCHASE_CATEGORY_KEYS } from '@rmm/shared';
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm } from '../../core/context.js';
import { badRequest, notFound } from '../../core/errors.js';
import type { Tx } from '../../db/client.js';
import { docTables, inboxItems, masterTables, shipments } from '../../db/schema/index.js';
import { confirmItem, linkCreatedOrder, MAX_INTAKE_BYTES, orderDraft, processItem, saveCheckedFields, storeUpload, suggestFor, suggestPurchase } from './intake.service.js';
import { orderBuyer } from '../documents/names.js';

const MOD = 'sales.intake';

const confirmSchema = z.object({
  kind: z.enum(INTAKE_KINDS.map((k) => k.key) as [string, ...string[]]),
  fields: z.record(z.string(), z.string().max(2000).nullable()),
  orderId: z.uuid().nullable().optional(),
  shipmentId: z.uuid().nullable().optional(),
  order: z.record(z.string(), z.unknown()).optional(),
  purchase: z.object({ supplierId: z.uuid().nullable().optional(), category: z.enum(PURCHASE_CATEGORY_KEYS).optional(), vendorPoId: z.uuid().nullable().optional(), description: z.string().max(500).nullable().optional() }).optional(),
});

async function loadItem(tx: Tx, id: string) {
  const [row] = await tx.select().from(inboxItems).where(and(eq(inboxItems.id, id), isNull(inboxItems.deletedAt)));
  if (!row) throw notFound('Document not found in the inbox', 'It may have been deleted (see the recycle bin).');
  return row;
}

function listConditions(q: { status?: string; kind?: string }): SQL[] {
  const conds: SQL[] = [isNull(inboxItems.deletedAt)];
  if (q.status === 'OPEN') conds.push(sql`${inboxItems.status} in ('QUEUED','READING','TO_REVIEW','FAILED')`);
  else if (q.status && q.status !== 'ALL') conds.push(eq(inboxItems.status, q.status));
  if (q.kind) conds.push(eq(inboxItems.kind, q.kind));
  return conds;
}

async function orderInfo(tx: Tx, id: string | null) {
  if (!id) return null;
  const pi = docTables.proformaInvoices.header;
  const cu = masterTables.customers;
  const [o] = (await tx
    .select({ id: pi.id, number: pi.documentNumber, buyerPoRef: pi.buyerPoRef, buyer: orderBuyer(), orderSource: pi.orderSource })
    .from(pi)
    .leftJoin(cu, eq(cu.id, pi.buyerId))
    .where(and(eq(pi.id, id), isNull(pi.deletedAt)))) as Record<string, unknown>[];
  return o ?? null;
}

async function lotsOf(tx: Tx, orderId: string | null) {
  if (!orderId) return [];
  return tx
    .select({ id: shipments.id, lotNo: shipments.lotNo, quantityMt: shipments.quantityMt, containerCount: shipments.containerCount, period: shipments.period, invoiceNumber: shipments.invoiceNumber, blNumber: shipments.blNumber, status: shipments.status })
    .from(shipments)
    .where(and(eq(shipments.proformaInvoiceId, orderId), isNull(shipments.deletedAt)))
    .orderBy(asc(shipments.lotNo));
}

/** Check the order / lot a file is uploaded into belongs to this company (a lot implies its order). */
async function folder(tx: Tx, orderId?: string, shipmentId?: string) {
  const uuid = z.uuid();
  if (shipmentId) {
    const id = uuid.parse(shipmentId);
    const [s] = await tx.select({ id: shipments.id, orderId: shipments.proformaInvoiceId }).from(shipments).where(and(eq(shipments.id, id), isNull(shipments.deletedAt)));
    if (!s) throw notFound('Shipment lot not found', 'Reload the order and upload again.');
    return { orderId: s.orderId, shipmentId: s.id };
  }
  if (orderId) {
    const pi = docTables.proformaInvoices.header;
    const [o] = await tx.select({ id: pi.id }).from(pi).where(and(eq(pi.id, uuid.parse(orderId)), isNull(pi.deletedAt)));
    if (!o) throw notFound('Order not found', 'Reload the page and upload again.');
    return { orderId: o.id as string, shipmentId: null };
  }
  return {};
}

export async function intakeRoutes(app: FastifyInstance) {
  /** Upload one or many files (multipart). Reading starts in the background right away. */
  app.post<{ Querystring: { orderId?: string; shipmentId?: string } }>('/intake/upload', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'create');
    const companyId = requireCompany(ctx);
    const into = await inTenantTx(ctx, (tx) => folder(tx, req.query.orderId, req.query.shipmentId));
    const out: { id: string; fileName: string; duplicateOf: string | null; error?: string }[] = [];
    for await (const part of req.files({ limits: { fileSize: MAX_INTAKE_BYTES, files: 100 } })) {
      const buf = await part.toBuffer();
      if (part.file.truncated) {
        out.push({ id: '', fileName: part.filename, duplicateOf: null, error: `Larger than ${MAX_INTAKE_BYTES / 1024 / 1024} MB` });
        continue;
      }
      try {
        out.push(await storeUpload(companyId, ctx.userId, buf, part.filename, null, into));
      } catch (e) {
        out.push({ id: '', fileName: part.filename, duplicateOf: null, error: (e as Error).message });
      }
    }
    if (!out.length) throw badRequest('No file was received', 'Choose or drop one or more files and upload again.');
    return reply.status(201).send(out);
  });

  app.get<{ Querystring: { status?: string; kind?: string; search?: string; page?: string; orderId?: string; shipmentId?: string } }>('/intake', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    const q = req.query;
    return inTenantTx(ctx, async (tx) => {
      const conds = listConditions(q);
      if (q.orderId === 'none') conds.push(isNull(inboxItems.orderId));
      else if (q.orderId) conds.push(eq(inboxItems.orderId, q.orderId));
      if (q.shipmentId) conds.push(eq(inboxItems.shipmentId, q.shipmentId));
      if (q.search?.trim()) {
        const s = `%${q.search.trim()}%`;
        conds.push(or(ilike(inboxItems.fileName, s), ilike(inboxItems.sourcePath, s), sql`${inboxItems.refs}::text ilike ${s}`, sql`${inboxItems.fields}::text ilike ${s}`)!);
      }
      const page = Math.max(1, Number(q.page) || 1);
      const rows = await tx
        .select({
          id: inboxItems.id,
          fileName: inboxItems.fileName,
          fileKind: inboxItems.fileKind,
          sourcePath: inboxItems.sourcePath,
          status: inboxItems.status,
          kind: inboxItems.kind,
          kindConfidence: inboxItems.kindConfidence,
          readMethod: inboxItems.readMethod,
          ocrConfidence: inboxItems.ocrConfidence,
          pages: inboxItems.pages,
          orderId: inboxItems.orderId,
          shipmentId: inboxItems.shipmentId,
          result: inboxItems.result,
          error: inboxItems.error,
          refs: inboxItems.refs,
          createdAt: inboxItems.createdAt,
          orderNumber: sql<string | null>`(select pi.document_number from proforma_invoices pi where pi.id = ${inboxItems.orderId})`,
          lotNo: sql<number | null>`(select s.lot_no from shipments s where s.id = ${inboxItems.shipmentId})`,
        })
        .from(inboxItems)
        .where(and(...conds))
        .orderBy(desc(inboxItems.createdAt))
        .limit(100)
        .offset((page - 1) * 100);
      const [{ n }] = await tx.select({ n: count() }).from(inboxItems).where(and(...conds));
      const counts = await tx.select({ status: inboxItems.status, n: count() }).from(inboxItems).where(isNull(inboxItems.deletedAt)).groupBy(inboxItems.status);
      return { rows, total: n, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
    });
  });

  /** The inbox order by order: how many documents each order has and how many wait for review. */
  app.get<{ Querystring: { status?: string; kind?: string; search?: string; page?: string; source?: string } }>('/intake/groups', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    const q = req.query;
    return inTenantTx(ctx, async (tx) => {
      const pi = docTables.proformaInvoices.header;
      const cu = masterTables.customers;
      const conds = listConditions(q);
      if (q.source === 'po') conds.push(sql`${pi.orderSource} <> 'Our PI'`);
      if (q.source === 'pi') conds.push(eq(pi.orderSource, 'Our PI'));
      if (q.search?.trim()) {
        const s = `%${q.search.trim()}%`;
        conds.push(or(ilike(inboxItems.fileName, s), ilike(inboxItems.sourcePath, s), sql`${inboxItems.refs}::text ilike ${s}`, sql`${inboxItems.fields}::text ilike ${s}`, ilike(pi.documentNumber, s), ilike(pi.buyerPoRef, s), ilike(pi.buyerIdText, s), ilike(cu.name, s))!);
      }
      const page = Math.max(1, Number(q.page) || 1);
      const all = await tx
        .select({
          orderId: inboxItems.orderId,
          orderNumber: pi.documentNumber,
          buyer: orderBuyer(),
          buyerPoRef: pi.buyerPoRef,
          orderSource: pi.orderSource,
          total: sql<number>`count(*)::int`,
          toReview: sql<number>`count(*) filter (where ${inboxItems.status} in ('QUEUED','READING','TO_REVIEW','FAILED'))::int`,
          latest: sql<string>`max(${inboxItems.createdAt})`,
        })
        .from(inboxItems)
        .leftJoin(pi, eq(pi.id, inboxItems.orderId))
        .leftJoin(cu, eq(cu.id, pi.buyerId))
        .where(and(...conds))
        .groupBy(inboxItems.orderId, pi.documentNumber, cu.name, pi.buyerIdText, pi.buyerPoRef, pi.orderSource)
        // documents not linked to any order come first (they need attention), then the newest activity
        .orderBy(sql`(${inboxItems.orderId} is not null)`, desc(sql`max(${inboxItems.createdAt})`));
      const counts = await tx.select({ status: inboxItems.status, n: count() }).from(inboxItems).where(isNull(inboxItems.deletedAt)).groupBy(inboxItems.status);
      return { groups: all.slice((page - 1) * 20, page * 20), total: all.length, pageSize: 20, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
    });
  });

  app.get<{ Params: { id: string } }>('/intake/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const item = await loadItem(tx, req.params.id);
      const kind = intakeKind(item.kind);
      return {
        ...item,
        kindLabel: kind.label,
        action: kind.action,
        suggest: kind.action === 'order' ? await suggestFor(tx, item) : null,
        suggestBuy: kind.action === 'purchase' || kind.action === 'vendor-po' ? await suggestPurchase(tx, item) : null,
        order: await orderInfo(tx, item.orderId),
        lots: await lotsOf(tx, item.orderId),
      };
    });
  });

  /** Lots of an order, for the picker on the review screen. */
  app.get<{ Querystring: { orderId?: string } }>('/intake/lots', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, (tx) => lotsOf(tx, req.query.orderId ?? null));
  });

  app.post<{ Params: { id: string } }>('/intake/:id/confirm', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    requireCompany(ctx);
    const body = confirmSchema.parse(req.body);
    const action = intakeKind(body.kind).action;
    if (action === 'lot' || action === 'lot-doc') requirePerm(ctx, 'sales.shipments', 'edit');
    if (action === 'order-lc') requirePerm(ctx, 'sales.proformaInvoices', 'edit');
    if (action === 'purchase') requirePerm(ctx, 'sales.purchaseInvoices', 'create');
    if (action === 'vendor-po') requirePerm(ctx, 'sales.vendorPos', 'create');
    return inTenantTx(ctx, async (tx) => {
      const item = await loadItem(tx, req.params.id);
      if (item.status === 'CONFIRMED') throw badRequest('This document is already confirmed', 'Open the order or lot it was applied to, or upload a corrected document.');
      if (item.status === 'QUEUED' || item.status === 'READING') throw badRequest('This document is still being read', 'Wait a few seconds until it shows "To review", then confirm.');
      return confirmItem(tx, ctx, item, body as Parameters<typeof confirmItem>[3]);
    });
  });

  /** Keep the values checked on the review screen, before the full order form opens. */
  app.post<{ Params: { id: string } }>('/intake/:id/checked', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    requireCompany(ctx);
    const body = confirmSchema.pick({ kind: true, fields: true }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const item = await loadItem(tx, req.params.id);
      if (item.status === 'CONFIRMED') throw badRequest('This document is already confirmed');
      return saveCheckedFields(tx, ctx, item, body.kind, body.fields);
    });
  });

  /** A new order filled from this buyer PO / PI, for the full Orders / PIs form. */
  app.get<{ Params: { id: string } }>('/intake/:id/order-draft', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requirePerm(ctx, 'sales.proformaInvoices', 'create');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => orderDraft(tx, ctx, await loadItem(tx, req.params.id)));
  });

  /** After the order is saved in the form: file this document with it. */
  app.post<{ Params: { id: string } }>('/intake/:id/order', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    requireCompany(ctx);
    const { orderId } = z.object({ orderId: z.uuid() }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const item = await loadItem(tx, req.params.id);
      if (item.status === 'CONFIRMED') throw badRequest('This document is already confirmed');
      return linkCreatedOrder(tx, ctx, item, orderId);
    });
  });

  /** Read again (after a fix), optionally as another document kind. */
  app.post<{ Params: { id: string } }>('/intake/:id/reread', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    const companyId = requireCompany(ctx);
    const { kind } = z.object({ kind: z.string().max(40).optional() }).parse(req.body ?? {});
    await inTenantTx(ctx, async (tx) => {
      const item = await loadItem(tx, req.params.id);
      if (item.status === 'CONFIRMED') throw badRequest('This document is already confirmed');
    });
    await processItem(companyId, req.params.id, kind ? intakeKind(kind).key : undefined);
    return inTenantTx(ctx, (tx) => loadItem(tx, req.params.id));
  });

  app.post<{ Params: { id: string } }>('/intake/:id/ignore', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const item = await loadItem(tx, req.params.id);
      const status = item.status === 'IGNORED' ? 'TO_REVIEW' : 'IGNORED';
      await tx.update(inboxItems).set({ status, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(inboxItems.id, item.id));
      await audit(tx, ctx, { entity: 'inbox', recordId: item.id, action: status === 'IGNORED' ? 'ignore' : 'unignore' });
      return { status };
    });
  });

  app.delete<{ Params: { id: string } }>('/intake/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'delete');
    requireCompany(ctx);
    const reason = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {}).reason ?? null;
    return inTenantTx(ctx, async (tx) => {
      const item = await loadItem(tx, req.params.id);
      await tx.update(inboxItems).set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason }).where(eq(inboxItems.id, item.id));
      await audit(tx, ctx, { entity: 'inbox', recordId: item.id, action: 'delete', meta: { name: item.fileName, reason } });
      return { ok: true };
    });
  });
}
