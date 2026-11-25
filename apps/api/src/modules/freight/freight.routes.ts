/**
 * Freight quotations by email.
 *  /mail-account               the signed-in user's own mailbox (any user; the password is never returned)
 *  /freight/enquiries...       rate requests, conversations, quotes, comparison and award (sales.freight)
 */
import { businessDate, DEFAULT_MAIL_PROVIDER, DEFAULT_MAIL_TEMPLATES, detectMailProvider, isDecimal, isPositive, MAIL_PROVIDER_KEYS, MAIL_PROVIDERS, MAIL_TEMPLATE_KINDS, mailProvider, renderTemplate, type MailProviderKey } from '@rmm/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { audit } from '../../core/audit.js';
import { can, inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { decryptSecret, encryptSecret } from '../../core/secret.js';
import { db, type Tx } from '../../db/client.js';
import { docTables } from '../../db/schema/documents.js';
import { freightEnquiries, freightMessages, freightQuotes, freightThreads, mailAccounts, masterTables, users } from '../../db/schema/index.js';
import { shipments } from '../../db/schema/shipments.js';
import { allocateNumber } from '../numbering.js';
import {
  accountOf,
  applyFreightToShipment,
  compare,
  credentials,
  publicAccount,
  quoteText,
  requireAccount,
  sendInThread,
  senderName,
  startThread,
  syncAccount,
  templateFor,
  templateVars,
} from './freight.service.js';
import { mailDriver } from './mail.js';

const MOD = 'sales.freight';
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31');
const money = (msg: string) => z.string().trim().refine((v) => isDecimal(v) && isPositive(v), msg);

const accountSchema = z.object({
  email: z.email('Enter a valid email address').transform((v) => v.trim().toLowerCase()),
  displayName: z.string().trim().max(120).nullable().optional(),
  /** Google, Microsoft or Yahoo; the server settings come from the provider, users never type them. */
  provider: z.enum(MAIL_PROVIDER_KEYS as [MailProviderKey, ...MailProviderKey[]], { error: 'Choose Google, Microsoft or Yahoo' }).optional(),
  /** Required the first time; leave empty later to keep the saved one. Spaces (as Google shows it) are removed. */
  password: z.string().max(200).optional(),
});

const enquirySchema = z.object({
  enquiryDate: dateStr.optional(),
  shipmentId: z.uuid().nullable().optional(),
  proformaInvoiceId: z.uuid().nullable().optional(),
  portOfLoading: z.string().trim().min(2, 'Enter the port of loading').max(120),
  portOfDischarge: z.string().trim().min(2, 'Enter the port of discharge').max(120),
  containerType: z.string().trim().min(2, 'Enter the container type').max(60),
  containerCount: z.number().int().min(1, 'At least one container').max(999),
  commodity: z.string().trim().max(200).nullable().optional(),
  grossWeightMt: z.string().trim().refine((v) => v === '' || isDecimal(v), 'Enter a weight in MT').nullable().optional(),
  readyDate: dateStr.nullable().optional(),
  freeDaysWanted: z.number().int().min(0).max(60).nullable().optional(),
  incoterm: z.string().max(10).nullable().optional(),
  replyBy: dateStr.nullable().optional(),
  reminderHours: z.number().int().min(0).max(720).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const recipientSchema = z.union([
  z.object({ contactId: z.uuid() }),
  z.object({ email: z.email('Enter a valid email address'), name: z.string().trim().max(120).nullable().optional(), carrier: z.string().trim().min(1, 'Enter the shipping line or forwarder').max(120) }),
]);

const sendSchema = z.object({
  recipients: z.array(recipientSchema).min(1, 'Choose at least one contact').max(50),
  subject: z.string().trim().min(3).max(300),
  body: z.string().trim().min(10).max(20_000),
});

const replySchema = z.object({ subject: z.string().max(300).nullable().optional(), body: z.string().trim().min(2).max(20_000), targetRate: z.string().max(60).nullable().optional() });

const quoteSchema = z.object({
  currency: z.string().trim().length(3, 'Use a 3-letter currency code').transform((v) => v.toUpperCase()),
  amount: money('Enter the quoted amount'),
  perContainer: z.boolean().default(true),
  surcharges: z.string().trim().refine((v) => v === '' || isDecimal(v), 'Enter surcharges as a number').nullable().optional(),
  freeDays: z.number().int().min(0).max(120).nullable().optional(),
  transitDays: z.number().int().min(0).max(120).nullable().optional(),
  validUntil: dateStr.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  messageId: z.uuid().nullable().optional(),
});

const awardSchema = z.object({
  threadId: z.uuid(),
  notifyWinner: z.boolean().default(true),
  notifyOthers: z.boolean().default(true),
  applyToShipment: z.boolean().default(true),
});

const blank = (v: string | null | undefined) => (v === '' || v === undefined ? null : v);
const actor = (ctx: RequestContext) => ({ userId: ctx.userId, ip: ctx.ip });

async function loadEnquiry(tx: Tx, id: string) {
  const [e] = await tx.select().from(freightEnquiries).where(and(eq(freightEnquiries.id, id), isNull(freightEnquiries.deletedAt)));
  if (!e) throw notFound('Freight enquiry not found', 'It may have been deleted (see the recycle bin) or belong to another company.');
  return e;
}

async function loadThread(tx: Tx, id: string) {
  const [t] = await tx.select().from(freightThreads).where(eq(freightThreads.id, id));
  if (!t) throw notFound('Conversation not found', 'Reload the enquiry.');
  const e = await loadEnquiry(tx, t.enquiryId);
  return { t, e };
}

const openOnly = (e: { status: string; number: string }) => {
  if (e.status !== 'OPEN') throw conflict(`Enquiry ${e.number} is ${e.status.toLowerCase()}`, 'Re-open it first (Edit → status Open) to send more mails or change quotes.');
};

/** Contacts for an enquiry: those who quote these ports or this market first. */
async function suggestContacts(tx: Tx, e: { portOfLoading: string; portOfDischarge: string }, exclude: Set<string>) {
  const c = masterTables.freightContacts;
  const sl = masterTables.shippingLines;
  const sp = masterTables.serviceProviders;
  const rows = (await tx
    .select({ id: c.id, name: c.name, email: c.email, partyType: c.partyType, companyName: c.companyName, ports: c.ports, markets: c.markets, line: sl.name, forwarder: sp.name })
    .from(c)
    .leftJoin(sl, eq(sl.id, c.shippingLineId))
    .leftJoin(sp, eq(sp.id, c.serviceProviderId))
    .where(and(eq(c.isActive, true), isNull(c.deletedAt)))
    .orderBy(asc(c.name))) as { id: string; name: string; email: string; partyType: string; companyName: string | null; ports: string | null; markets: string | null; line: string | null; forwarder: string | null }[];
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const pol = words(e.portOfLoading);
  const pod = words(e.portOfDischarge);
  return rows
    .map((r) => {
      const ports = words(r.ports ?? '');
      const hitPol = pol.some((w) => ports.includes(w));
      const hitPod = pod.some((w) => ports.includes(w));
      const score = !ports.length ? 1 : (hitPol ? 2 : 0) + (hitPod ? 3 : 0);
      const reason = !ports.length ? 'Quotes all routes' : hitPol && hitPod ? 'Quotes this route' : hitPod ? 'Quotes this destination' : hitPol ? 'Quotes from this port' : 'Other routes';
      return { ...r, carrier: r.line ?? r.forwarder ?? r.companyName ?? r.email.split('@')[1], score, reason, alreadySent: exclude.has(r.email.toLowerCase()), suggested: score >= 1 };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

async function threadSummaries(tx: Tx, enquiryId: string) {
  const threads = await tx.select().from(freightThreads).where(eq(freightThreads.enquiryId, enquiryId)).orderBy(asc(freightThreads.createdAt));
  const ids = threads.map((t) => t.id);
  const quotes = ids.length ? await tx.select().from(freightQuotes).where(inArray(freightQuotes.threadId, ids)).orderBy(desc(freightQuotes.revision)) : [];
  const counts = ids.length
    ? await tx.select({ threadId: freightMessages.threadId, n: sql<number>`count(*)::int`, inbound: sql<number>`count(*) filter (where ${freightMessages.direction} = 'in')::int` }).from(freightMessages).where(inArray(freightMessages.threadId, ids)).groupBy(freightMessages.threadId)
    : [];
  const owners = ids.length ? await db().select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, [...new Set(threads.map((t) => t.ownerUserId))])) : [];
  return {
    threads,
    rows: threads.map((t) => {
      const q = quotes.filter((x) => x.threadId === t.id);
      const c = counts.find((x) => x.threadId === t.id);
      return { ...t, ownerName: owners.find((o) => o.id === t.ownerUserId)?.name ?? null, messages: c?.n ?? 0, replies: c?.inbound ?? 0, latestQuote: q[0] ?? null, quoteRounds: q.length, latestQuoteText: quoteText(q[0]) };
    }),
  };
}

export async function freightRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- my mailbox

  app.get('/mail-account', async (req) => {
    const ctx = requireCtx(req);
    return { ready: !!config.mailSecretKey(), account: publicAccount(await accountOf(ctx.userId)), providers: MAIL_PROVIDERS, pollMinutes: config.mailPollMinutes };
  });

  app.put('/mail-account', async (req) => {
    const ctx = requireCtx(req);
    const body = accountSchema.parse(req.body);
    const existing = await accountOf(ctx.userId);
    const preset = body.provider ? mailProvider(body.provider) : (detectMailProvider(body.email) ?? mailProvider(DEFAULT_MAIL_PROVIDER));
    const { label: _l, domains: _d, passwordHelp: _h, ...host } = preset;
    const password = body.password?.replace(/\s+/g, '') || null;
    if (!password && !existing) throw badRequest('Enter the app password', { fields: { password: 'Required' }, hint: preset.passwordHelp });
    const passwordEnc = password ? encryptSecret(password) : existing!.passwordEnc;
    const values = { email: body.email, displayName: blank(body.displayName ?? null), ...host, username: body.email, passwordEnc };
    // check the settings work before saving, so a typo never sits there half-working
    const probe = { ...values, password: password ?? decryptSecret(existing!.passwordEnc) };
    await mailDriver().verify(probe);
    const mailboxChanged = !existing || existing.email !== values.email || existing.imapHost !== values.imapHost || existing.username !== values.username;
    const now = new Date();
    const [row] = await db()
      .insert(mailAccounts)
      .values({ userId: ctx.userId, ...values, status: 'ok', lastError: null, updatedAt: now })
      .onConflictDoUpdate({ target: mailAccounts.userId, set: { ...values, status: 'ok', lastError: null, updatedAt: now, ...(mailboxChanged ? { imapUidValidity: null, imapLastUid: 0 } : {}) } })
      .returning();
    await audit(db(), { userId: ctx.userId, companyId: null, ip: ctx.ip }, { entity: 'mailAccounts', recordId: row.id, action: existing ? 'update' : 'create', meta: { email: row.email, provider: row.provider, passwordChanged: !!password } });
    return publicAccount(row);
  });

  app.delete('/mail-account', async (req) => {
    const ctx = requireCtx(req);
    // Removing the saved app password is a security action; the mails already stored stay in the ERP.
    const [row] = await db().delete(mailAccounts).where(eq(mailAccounts.userId, ctx.userId)).returning({ id: mailAccounts.id, email: mailAccounts.email });
    if (row) await audit(db(), { userId: ctx.userId, companyId: null, ip: ctx.ip }, { entity: 'mailAccounts', recordId: row.id, action: 'disconnect', meta: { email: row.email } });
    return { ok: true };
  });

  app.post('/mail-account/test', async (req) => {
    const ctx = requireCtx(req);
    const a = await requireAccount(ctx.userId);
    await mailDriver().send(credentials(a), {
      to: { name: a.displayName, address: a.email },
      subject: 'RMM ERP: test mail',
      text: `This is a test mail from the RMM Export ERP.\n\nIf you can read it, freight enquiries will be sent from ${a.email} and replies to them will be read back into the ERP every ${config.mailPollMinutes || '—'} minutes (or when you press "Check now").`,
      messageId: `<test-${Date.now()}@${a.email.split('@')[1]}>`,
    });
    return { ok: true, to: a.email };
  });

  app.post('/mail-account/sync', async (req) => {
    const ctx = requireCtx(req);
    await requireAccount(ctx.userId);
    return syncAccount(ctx.userId);
  });

  // ---------------------------------------------------------------- templates

  app.get('/freight/templates', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const t = masterTables.mailTemplates;
      const saved = (await tx.select({ id: t.id, name: t.name, kind: t.kind, subject: t.subject, body: t.body, isDefault: t.isDefault }).from(t).where(and(eq(t.isActive, true), isNull(t.deletedAt))).orderBy(desc(t.isDefault), asc(t.name))) as { id: string; name: string; kind: string; subject: string; body: string; isDefault: boolean }[];
      const builtIn = MAIL_TEMPLATE_KINDS.map((k) => ({ id: `builtin:${k}`, name: `${k} (standard)`, kind: k, ...DEFAULT_MAIL_TEMPLATES[k], isDefault: !saved.some((s) => s.kind === k), builtIn: true }));
      return [...saved.map((s) => ({ ...s, builtIn: false })), ...builtIn];
    });
  });

  // ---------------------------------------------------------------- enquiries

  app.get<{ Querystring: { status?: string; search?: string; shipmentId?: string } }>('/freight/enquiries', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const e = freightEnquiries;
      const conds = [isNull(e.deletedAt)];
      if (req.query.status) conds.push(eq(e.status, req.query.status));
      if (req.query.shipmentId) conds.push(eq(e.shipmentId, req.query.shipmentId));
      if (req.query.search) {
        const q = `%${req.query.search.trim()}%`;
        conds.push(or(ilike(e.number, q), ilike(e.portOfLoading, q), ilike(e.portOfDischarge, q), ilike(e.commodity, q))!);
      }
      const rows = await tx
        .select({
          id: e.id,
          number: e.number,
          enquiryDate: e.enquiryDate,
          status: e.status,
          portOfLoading: e.portOfLoading,
          portOfDischarge: e.portOfDischarge,
          containerType: e.containerType,
          containerCount: e.containerCount,
          readyDate: e.readyDate,
          replyBy: e.replyBy,
          shipmentId: e.shipmentId,
          sent: sql<number>`(select count(*)::int from freight_threads t where t.enquiry_id = freight_enquiries.id)`,
          replied: sql<number>`(select count(*)::int from freight_threads t where t.enquiry_id = ${e.id} and t.last_inbound_at is not null)`,
          quoted: sql<number>`(select count(distinct q.thread_id)::int from freight_quotes q where q.enquiry_id = freight_enquiries.id)`,
          unread: sql<number>`(select coalesce(sum(t.unread), 0)::int from freight_threads t where t.enquiry_id = freight_enquiries.id)`,
          awardedTo: sql<string | null>`(select t.carrier from freight_threads t where t.id = freight_enquiries.awarded_thread_id)`,
        })
        .from(e)
        .where(and(...conds))
        .orderBy(desc(e.enquiryDate), desc(e.number))
        .limit(500);
      return rows;
    });
  });

  /** Pre-filled values for a new enquiry from a shipment lot (route, containers, cargo). */
  app.get<{ Querystring: { shipmentId?: string } }>('/freight/enquiries/draft', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'create');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const base = { enquiryDate: businessDate(), reminderHours: config.mailReminderHours, containerCount: 1, containerType: '', portOfLoading: '', portOfDischarge: '' };
      if (!req.query.shipmentId) return base;
      const [s] = await tx.select().from(shipments).where(and(eq(shipments.id, req.query.shipmentId), isNull(shipments.deletedAt)));
      if (!s) throw notFound('Shipment lot not found');
      const pi = docTables.proformaInvoices.header as unknown as Record<string, never>;
      const ports = masterTables.ports;
      const [h] = (await tx.select().from(docTables.proformaInvoices.header).where(eq(pi.id, s.proformaInvoiceId))) as Record<string, unknown>[];
      const portName = async (id: unknown) => (id ? (((await tx.select({ n: ports.name }).from(ports).where(eq(ports.id, id as string))) as { n: string }[])[0]?.n ?? '') : '');
      const lines = docTables.proformaInvoices.lines!;
      const products = masterTables.products;
      const cargo = (await tx
        .selectDistinct({ n: products.name })
        .from(lines)
        .innerJoin(products, eq(products.id, lines.productId))
        .where(eq(lines.documentId, s.proformaInvoiceId))) as { n: string }[];
      const ct = masterTables.containerTypes;
      const [type] = (await tx.select({ n: ct.name }).from(ct).where(and(eq(ct.isActive, true), isNull(ct.deletedAt))).orderBy(asc(ct.name)).limit(1)) as { n: string }[];
      return {
        ...base,
        shipmentId: s.id,
        proformaInvoiceId: s.proformaInvoiceId,
        piNumber: h?.documentNumber ?? null,
        lotNo: s.lotNo,
        portOfLoading: await portName(h?.portOfLoadingId),
        portOfDischarge: await portName(h?.portOfDischargeId),
        containerCount: Math.max(1, s.containerCount),
        containerType: type?.n ?? '',
        commodity: cargo.map((c) => c.n).join(', ') || null,
        grossWeightMt: s.quantityMt,
        readyDate: s.targetShipDate,
        incoterm: (h?.incoterm as string) ?? null,
      };
    });
  });

  app.post('/freight/enquiries', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'create');
    const companyId = requireCompany(ctx);
    const body = enquirySchema.parse(req.body);
    const row = await inTenantTx(ctx, async (tx) => {
      const date = body.enquiryDate ?? businessDate();
      const number = await allocateNumber(tx, ctx, 'freight_enquiry', date);
      const [e] = await tx
        .insert(freightEnquiries)
        .values({ ...body, grossWeightMt: blank(body.grossWeightMt), companyId, number, enquiryDate: date, reminderHours: body.reminderHours ?? config.mailReminderHours, createdBy: ctx.userId, updatedBy: ctx.userId })
        .returning();
      await audit(tx, ctx, { entity: 'freightEnquiries', recordId: e.id, action: 'create', after: e });
      return e;
    });
    return reply.status(201).send(row);
  });

  app.get<{ Params: { id: string } }>('/freight/enquiries/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    const mine = await accountOf(ctx.userId);
    return inTenantTx(ctx, async (tx) => {
      const e = await loadEnquiry(tx, req.params.id);
      const { threads, rows } = await threadSummaries(tx, e.id);
      const comparison = await compare(tx, e, threads);
      let lot: { id: string; lotNo: number; piNumber: string | null } | null = null;
      if (e.shipmentId) {
        const pi = docTables.proformaInvoices.header;
        const [s] = await tx.select({ id: shipments.id, lotNo: shipments.lotNo, piNumber: pi.documentNumber }).from(shipments).leftJoin(pi, eq(pi.id, shipments.proformaInvoiceId)).where(eq(shipments.id, e.shipmentId));
        lot = s ?? null;
      }
      return { ...e, threads: rows, comparison, lot, myMailbox: mine?.email ?? null };
    });
  });

  app.put<{ Params: { id: string } }>('/freight/enquiries/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    requireCompany(ctx);
    const body = enquirySchema.extend({ status: z.enum(['OPEN', 'CLOSED', 'CANCELLED', 'AWARDED']).optional(), version: z.number().int() }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const before = await loadEnquiry(tx, req.params.id);
      if (before.version !== body.version) throw conflict();
      const { version: _v, ...rest } = body;
      const [after] = await tx
        .update(freightEnquiries)
        .set({ ...rest, grossWeightMt: blank(rest.grossWeightMt), updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${freightEnquiries.version} + 1` })
        .where(eq(freightEnquiries.id, before.id))
        .returning();
      await audit(tx, ctx, { entity: 'freightEnquiries', recordId: before.id, action: 'update', before, after });
      return after;
    });
  });

  app.delete<{ Params: { id: string } }>('/freight/enquiries/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'delete');
    requireCompany(ctx);
    const reason = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {}).reason ?? null;
    return inTenantTx(ctx, async (tx) => {
      const e = await loadEnquiry(tx, req.params.id);
      await tx.update(freightEnquiries).set({ deletedAt: new Date(), deletedBy: ctx.userId, deleteReason: reason }).where(eq(freightEnquiries.id, e.id));
      await audit(tx, ctx, { entity: 'freightEnquiries', recordId: e.id, action: 'delete', meta: { number: e.number, reason } });
      return { ok: true };
    });
  });

  app.get<{ Params: { id: string } }>('/freight/enquiries/:id/contacts', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const e = await loadEnquiry(tx, req.params.id);
      const sent = await tx.select({ email: freightThreads.contactEmail }).from(freightThreads).where(eq(freightThreads.enquiryId, e.id));
      return suggestContacts(tx, e, new Set(sent.map((s) => s.email)));
    });
  });

  /** Rendered preview of a template for one contact of this enquiry. */
  app.post<{ Params: { id: string } }>('/freight/enquiries/:id/preview', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    const body = z.object({ subject: z.string().max(300), body: z.string().max(20_000), contactName: z.string().nullable().optional(), carrier: z.string().nullable().optional(), threadId: z.uuid().nullable().optional(), targetRate: z.string().max(60).nullable().optional() }).parse(req.body);
    const a = await accountOf(ctx.userId);
    return inTenantTx(ctx, async (tx) => {
      const e = await loadEnquiry(tx, req.params.id);
      let target = { contactName: body.contactName ?? null, carrier: body.carrier ?? 'the shipping line' };
      let their: string | null = null;
      if (body.threadId) {
        const { t } = await loadThread(tx, body.threadId);
        target = t;
        const [q] = await tx.select().from(freightQuotes).where(eq(freightQuotes.threadId, t.id)).orderBy(desc(freightQuotes.revision)).limit(1);
        their = quoteText(q);
      }
      const name = a ? await senderName(a) : ((await db().select({ n: users.fullName }).from(users).where(eq(users.id, ctx.userId)))[0]?.n ?? '');
      const vars = await templateVars(tx, e, target, name, { their_rate: their, target_rate: body.targetRate ?? null });
      // the editor shows each placeholder as a box holding its real value
      const values = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v === null || v === undefined || v === '' ? null : String(v)]));
      return { subject: renderTemplate(body.subject, vars), body: renderTemplate(body.body, vars), vars: values };
    });
  });

  /** Send the rate request to the chosen contacts, one personal mail each. */
  app.post<{ Params: { id: string } }>('/freight/enquiries/:id/send', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'create');
    const companyId = requireCompany(ctx);
    const body = sendSchema.parse(req.body);
    const a = await requireAccount(ctx.userId);
    const { e, targets } = await inTenantTx(ctx, async (tx) => {
      const e = await loadEnquiry(tx, req.params.id);
      openOnly(e);
      const contactIds = body.recipients.flatMap((r) => ('contactId' in r ? [r.contactId] : []));
      const suggestions = contactIds.length ? await suggestContacts(tx, e, new Set()) : [];
      const sent = new Set((await tx.select({ email: freightThreads.contactEmail }).from(freightThreads).where(eq(freightThreads.enquiryId, e.id))).map((s) => s.email));
      const targets = body.recipients.map((r) => {
        if ('contactId' in r) {
          const c = suggestions.find((s) => s.id === r.contactId);
          if (!c) throw badRequest('One of the chosen contacts no longer exists or is inactive', 'Reload the contact list and choose again.');
          return { contactId: c.id, name: c.name, email: c.email.toLowerCase(), carrier: c.carrier };
        }
        return { contactId: null, name: r.name ?? null, email: r.email.toLowerCase(), carrier: r.carrier };
      });
      const unique = targets.filter((t, i) => targets.findIndex((x) => x.email === t.email) === i && !sent.has(t.email));
      if (!unique.length) throw badRequest('The rate request was already sent to everyone chosen', 'Open their conversation to send a reminder or a follow-up instead.');
      return { e, targets: unique };
    });
    const sent: { email: string; threadId: string }[] = [];
    const failed: { email: string; error: string; hint?: string }[] = [];
    for (const t of targets) {
      try {
        sent.push(await startThread(companyId, a, e, t, body, actor(ctx)));
      } catch (err) {
        const ae = err as { message?: string; hint?: string; code?: string };
        failed.push({ email: t.email, error: ae.message ?? 'Could not send', hint: ae.hint });
        // a rejected login fails every mail the same way: stop instead of trying the rest
        if (ae.code === 'mail_auth_failed' || ae.code === 'mail_password_unreadable') {
          for (const rest of targets.slice(targets.indexOf(t) + 1)) failed.push({ email: rest.email, error: 'Not sent (mailbox login failed)' });
          break;
        }
      }
    }
    return { sent, failed };
  });

  /** Remind everyone who has not replied yet. */
  app.post<{ Params: { id: string } }>('/freight/enquiries/:id/remind', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    const companyId = requireCompany(ctx);
    const a = await requireAccount(ctx.userId);
    const { due, tpl } = await inTenantTx(ctx, async (tx) => {
      const e = await loadEnquiry(tx, req.params.id);
      openOnly(e);
      const due = await tx.select({ id: freightThreads.id }).from(freightThreads).where(and(eq(freightThreads.enquiryId, e.id), eq(freightThreads.status, 'SENT'), eq(freightThreads.ownerUserId, ctx.userId)));
      return { due, tpl: await templateFor(tx, 'Reminder') };
    });
    for (const t of due) await sendInThread(companyId, a, t.id, tpl, actor(ctx), { reminder: true });
    return { reminded: due.length };
  });

  app.post<{ Params: { id: string } }>('/freight/enquiries/:id/award', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    const companyId = requireCompany(ctx);
    const body = awardSchema.parse(req.body);
    if (body.applyToShipment && !can(ctx, 'sales.shipments', 'edit')) requirePerm(ctx, 'sales.shipments', 'edit');
    const a = body.notifyWinner || body.notifyOthers ? await requireAccount(ctx.userId) : null;
    const result = await inTenantTx(ctx, async (tx) => {
      const e = await loadEnquiry(tx, req.params.id);
      if (e.status !== 'OPEN') throw conflict(`Enquiry ${e.number} is already ${e.status.toLowerCase()}`, 'Each enquiry is awarded once. Re-open it in Edit if the booking changed.');
      const { t } = await loadThread(tx, body.threadId);
      if (t.enquiryId !== e.id) throw badRequest('That conversation belongs to another enquiry');
      const [q] = await tx.select().from(freightQuotes).where(eq(freightQuotes.threadId, t.id)).orderBy(desc(freightQuotes.revision)).limit(1);
      if (!q) throw badRequest(`${t.carrier} has no quote yet`, 'Record their rate first (Add / correct quote), then award.');
      await tx.update(freightThreads).set({ status: 'AWARDED' }).where(eq(freightThreads.id, t.id));
      await tx.update(freightQuotes).set({ auto: false }).where(eq(freightQuotes.id, q.id));
      const others = await tx.select().from(freightThreads).where(and(eq(freightThreads.enquiryId, e.id), sql`${freightThreads.id} <> ${t.id}`));
      await tx.update(freightThreads).set({ status: 'REGRETTED' }).where(and(eq(freightThreads.enquiryId, e.id), sql`${freightThreads.id} <> ${t.id}`));
      await tx.update(freightEnquiries).set({ status: 'AWARDED', awardedThreadId: t.id, updatedAt: new Date(), updatedBy: ctx.userId, version: sql`${freightEnquiries.version} + 1` }).where(eq(freightEnquiries.id, e.id));
      const charge = body.applyToShipment ? await applyFreightToShipment(tx, e, t.carrier, q) : null;
      await audit(tx, ctx, { entity: 'freightEnquiries', recordId: e.id, action: 'award', meta: { carrier: t.carrier, quote: quoteText(q), charge } });
      return { t, others, charge, tpl: { award: await templateFor(tx, 'Award'), regret: await templateFor(tx, 'Regret') } };
    });
    // the award is saved; mails follow (a mail that fails is reported, the award stands)
    const mailed: string[] = [];
    const failed: { email: string; error: string }[] = [];
    const notify = async (threadId: string, email: string, tpl: { subject: string; body: string }) => {
      try {
        await sendInThread(companyId, a!, threadId, tpl, actor(ctx));
        mailed.push(email);
      } catch (err) {
        failed.push({ email, error: (err as Error).message });
      }
    };
    if (body.notifyWinner && result.t.ownerUserId === ctx.userId) await notify(result.t.id, result.t.contactEmail, result.tpl.award);
    if (body.notifyOthers) for (const o of result.others.filter((o) => o.lastInboundAt && o.ownerUserId === ctx.userId)) await notify(o.id, o.contactEmail, result.tpl.regret);
    return { ok: true, charge: result.charge, mailed, failed };
  });

  // ---------------------------------------------------------------- conversations

  app.get<{ Params: { id: string } }>('/freight/threads/:id', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'view');
    requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const { t, e } = await loadThread(tx, req.params.id);
      const messages = await tx
        .select({ id: freightMessages.id, direction: freightMessages.direction, fromAddress: freightMessages.fromAddress, toAddress: freightMessages.toAddress, subject: freightMessages.subject, bodyText: freightMessages.bodyText, attachments: freightMessages.attachments, sentAt: freightMessages.sentAt, sentByUserId: freightMessages.sentByUserId })
        .from(freightMessages)
        .where(eq(freightMessages.threadId, t.id))
        .orderBy(asc(freightMessages.sentAt));
      const quotes = await tx.select().from(freightQuotes).where(eq(freightQuotes.threadId, t.id)).orderBy(asc(freightQuotes.revision));
      if (t.unread) await tx.update(freightThreads).set({ unread: 0 }).where(eq(freightThreads.id, t.id));
      return { ...t, unread: 0, enquiry: { id: e.id, number: e.number, status: e.status }, messages, quotes };
    });
  });

  app.post<{ Params: { id: string } }>('/freight/threads/:id/reply', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    const companyId = requireCompany(ctx);
    const body = replySchema.parse(req.body);
    const a = await requireAccount(ctx.userId);
    await inTenantTx(ctx, async (tx) => openOnly((await loadThread(tx, req.params.id)).e));
    const counter = !!body.targetRate;
    return sendInThread(companyId, a, req.params.id, body, actor(ctx), { extraVars: { target_rate: body.targetRate ?? null }, status: counter ? 'NEGOTIATING' : undefined });
  });

  /** Record a quote typed in (or correct one read automatically): every change is a new revision. */
  app.post<{ Params: { id: string } }>('/freight/threads/:id/quotes', async (req, reply) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    const companyId = requireCompany(ctx);
    const body = quoteSchema.parse(req.body);
    const row = await inTenantTx(ctx, async (tx) => {
      const { t, e } = await loadThread(tx, req.params.id);
      openOnly(e);
      const [max] = await tx.select({ n: sql<number>`coalesce(max(${freightQuotes.revision}), 0)::int` }).from(freightQuotes).where(eq(freightQuotes.threadId, t.id));
      const [q] = await tx
        .insert(freightQuotes)
        .values({ companyId, threadId: t.id, enquiryId: e.id, messageId: body.messageId ?? null, revision: max.n + 1, currency: body.currency, amount: body.amount, perContainer: body.perContainer, surcharges: blank(body.surcharges), freeDays: body.freeDays ?? null, transitDays: body.transitDays ?? null, validUntil: body.validUntil ?? null, notes: blank(body.notes), auto: false, createdBy: ctx.userId })
        .returning();
      if (!['AWARDED', 'REGRETTED'].includes(t.status)) await tx.update(freightThreads).set({ status: max.n > 0 ? 'NEGOTIATING' : 'QUOTED' }).where(eq(freightThreads.id, t.id));
      await audit(tx, ctx, { entity: 'freightEnquiries', recordId: e.id, action: 'quote', meta: { carrier: t.carrier, revision: q.revision, quote: quoteText(q) } });
      return q;
    });
    return reply.status(201).send(row);
  });

  /** Mark a contact as "no reply" (or back to sent) so reminders stop. */
  app.post<{ Params: { id: string } }>('/freight/threads/:id/status', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, MOD, 'edit');
    requireCompany(ctx);
    const { status } = z.object({ status: z.enum(['SENT', 'NO_REPLY', 'REPLIED']) }).parse(req.body);
    return inTenantTx(ctx, async (tx) => {
      const { t, e } = await loadThread(tx, req.params.id);
      openOnly(e);
      await tx.update(freightThreads).set({ status }).where(eq(freightThreads.id, t.id));
      return { ok: true };
    });
  });
}
