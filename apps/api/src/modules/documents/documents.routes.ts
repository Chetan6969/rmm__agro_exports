import { businessDate, DOC_LIST, getDoc } from '@rmm/shared';
import type { FastifyInstance } from 'fastify';
import { can, inTenantTx, requireCtx, requirePerm } from '../../core/context.js';
import { notFound } from '../../core/errors.js';
import { numberFormat } from '../numbering.js';
import {
  createDocument,
  deleteDocument,
  draftDocument,
  exportDocuments,
  getDocument,
  listDocuments,
  lookupDocuments,
  proformaFieldUsage,
  proformaTermsUsage,
  reorderDocument,
  setDocumentLock,
  updateDocument,
  type DocListQuery,
} from './documents.service.js';
import { documentPdf } from './pdf.js';

type P = { doc: string; id: string };

export async function documentRoutes(app: FastifyInstance) {
  /** Registry, so the web app renders document screens from the same definitions. */
  app.get('/meta/documents', async (req) => {
    requireCtx(req);
    return DOC_LIST;
  });

  app.get<{ Querystring: { field?: string } }>('/documents/proformaInvoices/reports/field-usage', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => proformaFieldUsage(tx, ctx, req.query.field ?? 'incoterm'));
  });

  app.get('/documents/proformaInvoices/reports/terms-usage', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => proformaTermsUsage(tx, ctx));
  });

  app.get<{ Params: P; Querystring: DocListQuery }>('/documents/:doc', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => listDocuments(tx, ctx, req.params.doc, req.query));
  });

  app.get<{ Params: P; Querystring: DocListQuery }>('/documents/:doc/export', async (req, reply) => {
    const ctx = requireCtx(req);
    const { filename, body } = await inTenantTx(ctx, (tx) => exportDocuments(tx, ctx, req.params.doc, req.query));
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${filename}"`).send(body);
  });

  app.get<{ Params: P; Querystring: { q?: string; ids?: string } }>('/documents/:doc/lookup', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => lookupDocuments(tx, ctx, req.params.doc, req.query));
  });

  /** Values for a new document; `?from=<parent id>` copies the parent and its remaining quantities.
   *  `?shipment=<lot id>` prefills a commercial invoice from a shipment lot and its proforma invoice. */
  app.get<{ Params: P; Querystring: { from?: string; shipment?: string } }>('/documents/:doc/draft', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => draftDocument(tx, ctx, req.params.doc, req.query.from || undefined, req.query.shipment || undefined));
  });

  /** Fixed prefix / suffix of this document type's number for a date, and the next running number. */
  app.get<{ Params: P; Querystring: { date?: string } }>('/documents/:doc/number-format', async (req) => {
    const ctx = requireCtx(req);
    const def = getDoc(req.params.doc);
    if (!def) throw notFound(`Unknown document type ${req.params.doc}`);
    if (!can(ctx, def.module, 'create') && !can(ctx, def.module, 'edit')) requirePerm(ctx, def.module, 'create');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '') ? req.query.date! : businessDate();
    return inTenantTx(ctx, (tx) => numberFormat(tx, ctx, def.numbering, date));
  });

  app.get<{ Params: P }>('/documents/:doc/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => getDocument(tx, ctx, req.params.doc, req.params.id));
  });

  for (const kind of ['document', 'packing-list'] as const) {
    app.get<{ Params: P; Querystring: { download?: string } }>(`/documents/:doc/:id/${kind === 'document' ? 'pdf' : 'packing-list.pdf'}`, async (req, reply) => {
      const ctx = requireCtx(req);
      const { filename, body } = await inTenantTx(ctx, (tx) => documentPdf(tx, ctx, req.params.doc, req.params.id, kind));
      return reply
        .header('content-type', 'application/pdf')
        .header('cache-control', 'private, no-store')
        .header('content-disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`)
        .send(body);
    });
  }

  app.post<{ Params: P }>('/documents/:doc', async (req, reply) => {
    const ctx = requireCtx(req);
    const row = await inTenantTx(ctx, (tx) => createDocument(tx, ctx, req.params.doc, req.body));
    return reply.status(201).send(row);
  });

  app.put<{ Params: P }>('/documents/:doc/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => updateDocument(tx, ctx, req.params.doc, req.params.id, req.body));
  });

  app.delete<{ Params: P; Body: { reason?: string } }>('/documents/:doc/:id', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => deleteDocument(tx, ctx, req.params.doc, req.params.id, req.body?.reason ?? ''));
  });

  app.post<{ Params: P; Body: { locked?: boolean } }>('/documents/:doc/:id/lock', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => setDocumentLock(tx, ctx, req.params.doc, req.params.id, req.body?.locked !== false));
  });

  app.post<{ Params: P; Body: { direction?: 'up' | 'down' } }>('/documents/:doc/:id/reorder', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => reorderDocument(tx, ctx, req.params.doc, req.params.id, req.body?.direction === 'down' ? 'down' : 'up'));
  });
}
