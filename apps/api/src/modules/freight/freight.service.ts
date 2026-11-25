/**
 * Freight quotations by email — the work behind the routes and the background worker.
 *
 * Sending: every mail goes out from the signed-in user's own mailbox with a Message-ID we
 * generate, and an "[FQ number]" tag in the subject. Both are recorded in freight_mail_index.
 *
 * Replies: the worker (and the "Check now" button) reads each connected INBOX over IMAP. A reply is
 * matched by its In-Reply-To / References headers through the index, or — when a mail client
 * dropped them — by the subject tag plus the sender's address. Matched replies are stored in the
 * thread, attachments saved, and a quote is read from the text automatically for the user to check.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  add,
  businessDate,
  DEFAULT_MAIL_TEMPLATES,
  enquiryTag,
  extractQuote,
  findEnquiryTag,
  mul,
  rankQuotes,
  renderTemplate,
  stripQuoted,
  type MailTemplateKind,
  type QuoteForRanking,
} from '@rmm/shared';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { simpleParser, type AddressObject } from 'mailparser';
import { config } from '../../config.js';
import { companiesForUser } from '../../core/access.js';
import { audit } from '../../core/audit.js';
import { inCompanyTx } from '../../core/context.js';
import { AppError, badRequest } from '../../core/errors.js';
import { decryptSecret } from '../../core/secret.js';
import { db, type Tx } from '../../db/client.js';
import { companies, files, freightEnquiries, freightMailIndex, freightMessages, freightQuotes, freightThreads, mailAccounts, masterTables, users } from '../../db/schema/index.js';
import { shipmentCharges, shipments } from '../../db/schema/shipments.js';
import { sniff } from '../files.routes.js';
import { mailDriver, type MailCredentials } from './mail.js';

type Account = typeof mailAccounts.$inferSelect;
type Enquiry = typeof freightEnquiries.$inferSelect;
type Thread = typeof freightThreads.$inferSelect;
type Quote = typeof freightQuotes.$inferSelect;

// ------------------------------------------------------------------ mailbox

export async function accountOf(userId: string): Promise<Account | null> {
  const [a] = await db().select().from(mailAccounts).where(eq(mailAccounts.userId, userId));
  return a ?? null;
}

export async function requireAccount(userId: string): Promise<Account> {
  const a = await accountOf(userId);
  if (!a) throw badRequest('Your mailbox is not connected yet', 'Open Freight quotations → My mailbox, enter your email address and app password, and save. Mails are then sent from your own address and replies come back to it.');
  return a;
}

export const credentials = (a: Account): MailCredentials => ({
  email: a.email,
  displayName: a.displayName,
  provider: a.provider,
  smtpHost: a.smtpHost,
  smtpPort: a.smtpPort,
  smtpSecure: a.smtpSecure,
  imapHost: a.imapHost,
  imapPort: a.imapPort,
  imapSecure: a.imapSecure,
  username: a.username,
  password: decryptSecret(a.passwordEnc),
});

/** What the web may see of a mailbox: everything except the password. */
export const publicAccount = (a: Account | null) =>
  a && {
    email: a.email,
    displayName: a.displayName,
    provider: a.provider,
    smtpHost: a.smtpHost,
    smtpPort: a.smtpPort,
    smtpSecure: a.smtpSecure,
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    imapSecure: a.imapSecure,
    username: a.username,
    status: a.status,
    lastError: a.lastError,
    lastSyncAt: a.lastSyncAt,
    updatedAt: a.updatedAt,
  };

/** Companies whose freight conversations a mailbox may hold. */
async function userCompanies(userId: string) {
  const [u] = await db().select({ sa: users.isSuperAdmin }).from(users).where(eq(users.id, userId));
  return companiesForUser(db(), userId, !!u?.sa);
}

const newMessageId = (email: string) => `<${randomUUID()}@${email.split('@')[1] ?? 'rmm-erp.local'}>`;
const normId = (v: string) => (v.trim().startsWith('<') ? v.trim() : `<${v.trim()}>`);

// ------------------------------------------------------------------ templates

const fmtDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null);

export async function templateFor(tx: Tx, kind: MailTemplateKind): Promise<{ subject: string; body: string }> {
  const t = masterTables.mailTemplates;
  const [row] = await tx
    .select({ subject: t.subject, body: t.body })
    .from(t)
    .where(and(eq(t.kind, kind), eq(t.isActive, true), isNull(t.deletedAt)))
    .orderBy(desc(t.isDefault), asc(t.name))
    .limit(1);
  return (row as { subject: string; body: string } | undefined) ?? DEFAULT_MAIL_TEMPLATES[kind];
}

export const quoteText = (q: Pick<Quote, 'currency' | 'amount' | 'perContainer' | 'surcharges'> | null | undefined) =>
  q ? `${q.currency} ${Number(q.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}${q.perContainer ? ' per container' : ' lump sum'}${q.surcharges && Number(q.surcharges) ? ` + ${q.currency} ${q.surcharges} surcharges` : ''}` : null;

export async function templateVars(tx: Tx, e: Enquiry, t: { contactName: string | null; carrier: string }, senderName: string, extra: Record<string, string | null> = {}) {
  const [co] = await tx.select({ name: companies.legalName, short: companies.name }).from(companies).where(eq(companies.id, e.companyId));
  return {
    contact_name: t.contactName || 'Sir / Madam',
    carrier: t.carrier,
    pol: e.portOfLoading,
    pod: e.portOfDischarge,
    containers: `${e.containerCount} × ${e.containerType}`,
    commodity: e.commodity,
    weight: e.grossWeightMt ? `${Number(e.grossWeightMt)} MT` : null,
    ready_date: fmtDate(e.readyDate),
    free_days: e.freeDaysWanted,
    incoterm: e.incoterm,
    reference: e.number,
    deadline: fmtDate(e.replyBy) ?? 'the earliest',
    sender_name: senderName,
    company: co?.name || co?.short || null,
    ...extra,
  };
}

export async function senderName(a: Account): Promise<string> {
  if (a.displayName) return a.displayName;
  const [u] = await db().select({ n: users.fullName }).from(users).where(eq(users.id, a.userId));
  return u?.n ?? a.email;
}

const withTag = (subject: string, number: string) => (subject.includes(enquiryTag(number)) ? subject : `${subject} ${enquiryTag(number)}`);

// ------------------------------------------------------------------ sending

export interface SendResult {
  threadId: string;
  email: string;
}

/**
 * Send the first mail of a new thread. The mail leaves first; only a mail the server accepted is
 * recorded, so the screen never shows a "sent" mail that did not go.
 */
export async function startThread(
  companyId: string,
  a: Account,
  e: Enquiry,
  to: { contactId: string | null; name: string | null; email: string; carrier: string },
  text: { subject: string; body: string },
  actor: { userId: string; ip: string | null },
): Promise<SendResult> {
  const sender = await senderName(a);
  const rendered = await inCompanyTx(companyId, async (tx) => {
    const vars = await templateVars(tx, e, { contactName: to.name, carrier: to.carrier }, sender);
    return { subject: withTag(renderTemplate(text.subject, vars), e.number), body: renderTemplate(text.body, vars) };
  });
  const messageId = newMessageId(a.email);
  await mailDriver().send(credentials(a), { to: { name: to.name, address: to.email }, subject: rendered.subject, text: rendered.body, messageId });
  const now = new Date();
  return inCompanyTx(companyId, async (tx) => {
    const [t] = await tx
      .insert(freightThreads)
      .values({ companyId, enquiryId: e.id, contactId: to.contactId, contactName: to.name, contactEmail: to.email.toLowerCase(), carrier: to.carrier, ownerUserId: a.userId, status: 'SENT', lastOutboundAt: now })
      .returning();
    await tx.insert(freightMessages).values({ companyId, threadId: t.id, direction: 'out', messageId, fromAddress: a.email, toAddress: to.email, subject: rendered.subject, bodyText: rendered.body, sentByUserId: actor.userId, sentAt: now });
    await tx.insert(freightMailIndex).values({ messageId, companyId, threadId: t.id }).onConflictDoNothing();
    await audit(tx, { userId: actor.userId, companyId, ip: actor.ip }, { entity: 'freightEnquiries', recordId: e.id, action: 'mail_sent', meta: { to: to.email, carrier: to.carrier, subject: rendered.subject } });
    return { threadId: t.id, email: to.email };
  });
}

/** Send a mail inside an existing thread (reply, counter offer, reminder, award, regret). */
export async function sendInThread(
  companyId: string,
  a: Account,
  threadId: string,
  text: { subject?: string | null; body: string },
  actor: { userId: string | null; ip: string | null },
  opts: { extraVars?: Record<string, string | null>; status?: string; reminder?: boolean } = {},
) {
  const sender = await senderName(a);
  const prep = await inCompanyTx(companyId, async (tx) => {
    const [t] = await tx.select().from(freightThreads).where(eq(freightThreads.id, threadId));
    if (!t) throw new AppError(404, 'not_found', 'Conversation not found', 'Reload the enquiry.');
    const [e] = await tx.select().from(freightEnquiries).where(eq(freightEnquiries.id, t.enquiryId));
    const msgs = await tx.select({ messageId: freightMessages.messageId, direction: freightMessages.direction, subject: freightMessages.subject }).from(freightMessages).where(eq(freightMessages.threadId, t.id)).orderBy(asc(freightMessages.sentAt));
    const [last] = await tx.select().from(freightQuotes).where(eq(freightQuotes.threadId, t.id)).orderBy(desc(freightQuotes.revision)).limit(1);
    const vars = await templateVars(tx, e, t, sender, { their_rate: quoteText(last), ...opts.extraVars });
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
    const parent = lastIn ?? msgs[msgs.length - 1];
    const base = text.subject?.trim() ? renderTemplate(text.subject, vars) : `Re: ${(msgs[0]?.subject ?? '').replace(/^(re|fw|fwd):\s*/i, '')}`;
    return { t, e, vars, parent, refs: msgs.map((m) => m.messageId).slice(-20), subject: withTag(base, e.number), body: renderTemplate(text.body, vars) };
  });
  if (prep.t.ownerUserId !== a.userId) {
    // replies to this thread arrive in the owner's mailbox; sending from another one would split it
    throw badRequest('This conversation belongs to another user\'s mailbox', 'Ask the colleague who sent the enquiry to reply, or start a new enquiry from your own mailbox.');
  }
  const messageId = newMessageId(a.email);
  await mailDriver().send(credentials(a), { to: { name: prep.t.contactName, address: prep.t.contactEmail }, subject: prep.subject, text: prep.body, messageId, inReplyTo: prep.parent?.messageId ?? null, references: prep.refs });
  const now = new Date();
  return inCompanyTx(companyId, async (tx) => {
    const [m] = await tx
      .insert(freightMessages)
      .values({ companyId, threadId, direction: 'out', messageId, inReplyTo: prep.parent?.messageId ?? null, references: prep.refs.join(' ') || null, fromAddress: a.email, toAddress: prep.t.contactEmail, subject: prep.subject, bodyText: prep.body, sentByUserId: actor.userId, sentAt: now })
      .returning({ id: freightMessages.id });
    await tx.insert(freightMailIndex).values({ messageId, companyId, threadId }).onConflictDoNothing();
    await tx
      .update(freightThreads)
      .set({ lastOutboundAt: now, status: opts.status ?? sql`${freightThreads.status}`, remindersSent: opts.reminder ? sql`${freightThreads.remindersSent} + 1` : sql`${freightThreads.remindersSent}` })
      .where(eq(freightThreads.id, threadId));
    await audit(tx, { userId: actor.userId, companyId, ip: actor.ip }, { entity: 'freightEnquiries', recordId: prep.e.id, action: opts.reminder ? 'mail_reminder' : 'mail_sent', meta: { to: prep.t.contactEmail, carrier: prep.t.carrier, subject: prep.subject } });
    return { messageId: m.id };
  });
}

// ------------------------------------------------------------------ receiving

const firstAddress = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a[0] : a)?.value?.[0];
const allAddresses = (a: AddressObject | AddressObject[] | undefined) => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map((v) => v.address ?? '')).filter(Boolean);

interface Match {
  companyId: string;
  threadId: string;
}

async function matchReply(a: Account, ids: string[], subject: string, from: string): Promise<Match | null> {
  if (ids.length) {
    const hits = await db().select().from(freightMailIndex).where(inArray(freightMailIndex.messageId, ids));
    for (const h of hits) {
      const owner = await inCompanyTx(h.companyId, (tx) => tx.select({ owner: freightThreads.ownerUserId }).from(freightThreads).where(eq(freightThreads.id, h.threadId)));
      if (owner[0]?.owner === a.userId) return { companyId: h.companyId, threadId: h.threadId };
    }
  }
  const number = findEnquiryTag(subject);
  if (!number) return null;
  const domain = from.split('@')[1] ?? '';
  for (const c of await userCompanies(a.userId)) {
    const found = await inCompanyTx(c.id, async (tx) => {
      const rows = await tx
        .select({ id: freightThreads.id, email: freightThreads.contactEmail })
        .from(freightThreads)
        .innerJoin(freightEnquiries, eq(freightEnquiries.id, freightThreads.enquiryId))
        .where(and(eq(freightEnquiries.number, number), eq(freightThreads.ownerUserId, a.userId), isNull(freightEnquiries.deletedAt)));
      // same address first; else a colleague at the same carrier (same domain) when that is unambiguous
      const exact = rows.find((r) => r.email === from);
      if (exact) return exact.id;
      const sameDomain = rows.filter((r) => domain && r.email.endsWith(`@${domain}`));
      return sameDomain.length === 1 ? sameDomain[0].id : null;
    });
    if (found) return { companyId: c.id, threadId: found };
  }
  return null;
}

async function saveAttachment(tx: Tx, companyId: string, userId: string, att: { filename?: string; contentType: string; content: Buffer; size: number }) {
  const name = (att.filename || 'attachment').slice(0, 200);
  if (att.size > config.mailMaxAttachmentBytes) return { fileId: '', name, size: att.size, mime: att.contentType };
  const kind = sniff(att.content);
  const id = randomUUID();
  const ext = kind?.ext ?? (path.extname(name).replace(/[^a-z0-9.]/gi, '').slice(0, 8) || '.bin').replace(/^\./, '');
  const rel = path.join(new Date().toISOString().slice(0, 7), `${id}.${ext}`);
  const abs = path.join(config.storageDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, att.content, { mode: 0o640 });
  // Only types the browser can show safely open inline; everything else downloads (octet-stream).
  const mime = kind?.mime ?? 'application/octet-stream';
  await tx.insert(files).values({ id, companyId, originalName: name, mimeType: mime, sizeBytes: att.size, sha256: createHash('sha256').update(att.content).digest('hex'), storagePath: rel, createdBy: userId });
  return { fileId: id, name, size: att.size, mime: att.contentType };
}

export interface IngestResult {
  matched: boolean;
  duplicate?: boolean;
  quoteId?: string | null;
  threadId?: string;
}

/** Store one raw mail from a user's inbox if it belongs to one of their freight conversations. */
export async function ingestRaw(a: Account, source: Buffer, fallbackId: string): Promise<IngestResult> {
  const p = await simpleParser(source);
  const from = (firstAddress(p.from)?.address ?? '').toLowerCase();
  if (!from || from === a.email.toLowerCase()) return { matched: false };
  const refs = Array.isArray(p.references) ? p.references : p.references ? p.references.split(/\s+/) : [];
  const ids = [p.inReplyTo, ...refs].filter((x): x is string => !!x).map(normId);
  const subject = p.subject ?? '(no subject)';
  const match = await matchReply(a, ids, subject, from);
  if (!match) return { matched: false };
  const messageId = p.messageId ? normId(p.messageId) : fallbackId;
  const text = (p.text ?? '').trim() || '(empty message)';

  return inCompanyTx(match.companyId, async (tx) => {
    const [dupe] = await tx.select({ id: freightMessages.id }).from(freightMessages).where(and(eq(freightMessages.companyId, match.companyId), eq(freightMessages.messageId, messageId)));
    if (dupe) return { matched: true, duplicate: true, threadId: match.threadId };
    const attachments = [];
    for (const att of p.attachments ?? []) {
      if (att.contentDisposition === 'inline' && att.contentType.startsWith('image/')) continue; // signatures, logos
      attachments.push(await saveAttachment(tx, match.companyId, a.userId, att));
    }
    // a reply cannot be older than the mail it answers (the sender's clock may be behind)
    const header = p.date && !Number.isNaN(p.date.getTime()) ? p.date : new Date();
    const [parent] = ids.length ? await tx.select({ at: sql<Date>`max(${freightMessages.sentAt})` }).from(freightMessages).where(and(eq(freightMessages.threadId, match.threadId), inArray(freightMessages.messageId, ids))) : [];
    const after = parent?.at ? new Date(new Date(parent.at).getTime() + 1000) : null;
    const sentAt = after && after > header ? after : header;
    const [m] = await tx
      .insert(freightMessages)
      .values({
        companyId: match.companyId,
        threadId: match.threadId,
        direction: 'in',
        messageId,
        inReplyTo: p.inReplyTo ? normId(p.inReplyTo) : null,
        references: refs.join(' ') || null,
        fromAddress: from,
        toAddress: allAddresses(p.to).join(', ') || a.email,
        subject,
        bodyText: text.slice(0, 200_000),
        bodyHtml: typeof p.html === 'string' ? p.html.slice(0, 500_000) : null,
        attachments: attachments.length ? attachments : null,
        sentAt,
      })
      .returning({ id: freightMessages.id });
    await tx.insert(freightMailIndex).values({ messageId, companyId: match.companyId, threadId: match.threadId }).onConflictDoNothing();

    const [t] = await tx.select().from(freightThreads).where(eq(freightThreads.id, match.threadId));
    const prior = await tx.select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${freightQuotes.revision}), 0)::int` }).from(freightQuotes).where(eq(freightQuotes.threadId, t.id));
    const q = extractQuote(stripQuoted(text), businessDate());
    let quoteId: string | null = null;
    if (q.amount && q.currency) {
      const [row] = await tx
        .insert(freightQuotes)
        .values({ companyId: match.companyId, threadId: t.id, enquiryId: t.enquiryId, messageId: m.id, revision: prior[0].max + 1, currency: q.currency, amount: q.amount, perContainer: q.perContainer, freeDays: q.freeDays, transitDays: q.transitDays, validUntil: q.validUntil, auto: true, evidence: q.evidence, notes: 'Read automatically from the reply — please check' })
        .returning({ id: freightQuotes.id });
      quoteId = row.id;
    }
    const closed = t.status === 'AWARDED' || t.status === 'REGRETTED';
    const status = closed ? t.status : quoteId ? (prior[0].n > 0 ? 'NEGOTIATING' : 'QUOTED') : t.status === 'SENT' || t.status === 'NO_REPLY' ? 'REPLIED' : t.status;
    await tx.update(freightThreads).set({ status, lastInboundAt: sentAt, unread: sql`${freightThreads.unread} + 1` }).where(eq(freightThreads.id, t.id));
    await audit(tx, { userId: a.userId, companyId: match.companyId, ip: null }, { entity: 'freightEnquiries', recordId: t.enquiryId, action: 'mail_received', meta: { from, carrier: t.carrier, subject, quote: quoteId ? `${q.currency} ${q.amount}` : null } });
    return { matched: true, quoteId, threadId: t.id };
  });
}

export interface SyncSummary {
  checked: number;
  matched: number;
  quotes: number;
}

const syncing = new Set<string>();

/** Read new mail of one mailbox. Safe to call while another check runs (it then does nothing). */
export async function syncAccount(userId: string): Promise<SyncSummary> {
  const a = await accountOf(userId);
  if (!a || syncing.has(a.id)) return { checked: 0, matched: 0, quotes: 0 };
  syncing.add(a.id);
  try {
    const batch = await mailDriver().fetchNew(credentials(a), { uidValidity: a.imapUidValidity, lastUid: a.imapLastUid }, config.mailLookbackDays);
    let matched = 0;
    let quotes = 0;
    for (const m of batch.messages) {
      const r = await ingestRaw(a, m.source, `<uid-${batch.uidValidity}-${m.uid}@${a.imapHost}>`);
      if (r.matched && !r.duplicate) matched++;
      if (r.quoteId) quotes++;
    }
    await db().update(mailAccounts).set({ imapUidValidity: batch.uidValidity, imapLastUid: batch.lastUid, lastSyncAt: new Date(), status: 'ok', lastError: null }).where(eq(mailAccounts.id, a.id));
    return { checked: batch.messages.length, matched, quotes };
  } catch (e) {
    const msg = e instanceof AppError ? `${e.message}. ${e.hint ?? ''}`.trim() : (e as Error).message;
    await db().update(mailAccounts).set({ status: 'error', lastError: msg.slice(0, 500), lastSyncAt: new Date() }).where(eq(mailAccounts.id, a.id));
    throw e;
  } finally {
    syncing.delete(a.id);
  }
}

// ------------------------------------------------------------------ reminders

/** Remind contacts who have not answered an open enquiry within its reminder window. */
export async function sendDueReminders(userId: string): Promise<number> {
  const a = await accountOf(userId);
  if (!a || a.status !== 'ok' || config.mailMaxReminders === 0) return 0;
  let sent = 0;
  for (const c of await userCompanies(userId)) {
    const due = await inCompanyTx(c.id, (tx) =>
      tx
        .select({ id: freightThreads.id })
        .from(freightThreads)
        .innerJoin(freightEnquiries, eq(freightEnquiries.id, freightThreads.enquiryId))
        .where(
          and(
            eq(freightThreads.ownerUserId, userId),
            eq(freightThreads.status, 'SENT'),
            lt(freightThreads.remindersSent, config.mailMaxReminders),
            eq(freightEnquiries.status, 'OPEN'),
            isNull(freightEnquiries.deletedAt),
            sql`${freightEnquiries.reminderHours} > 0`,
            sql`${freightThreads.lastOutboundAt} < now() - make_interval(hours => ${freightEnquiries.reminderHours})`,
          ),
        ),
    );
    if (!due.length) continue;
    const tpl = await inCompanyTx(c.id, (tx) => templateFor(tx, 'Reminder'));
    for (const t of due) {
      await sendInThread(c.id, a, t.id, tpl, { userId: null, ip: null }, { reminder: true });
      sent++;
    }
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;

/** Background loop: check every connected mailbox and send due reminders every MAIL_POLL_MINUTES. */
export function startMailWorker(log: { warn: (o: unknown, m: string) => void }) {
  if (!config.mailPollMinutes || timer) return;
  let busy = false;
  const tick = async () => {
    if (busy || !config.mailSecretKey()) return;
    busy = true;
    try {
      for (const a of await db().select({ userId: mailAccounts.userId, email: mailAccounts.email }).from(mailAccounts)) {
        await syncAccount(a.userId).catch((e) => log.warn(e, `mail check failed for ${a.email}`));
        await sendDueReminders(a.userId).catch((e) => log.warn(e, `reminders failed for ${a.email}`));
      }
    } finally {
      busy = false;
    }
  };
  timer = setInterval(() => void tick(), config.mailPollMinutes * 60_000);
  timer.unref();
  setTimeout(() => void tick(), 15_000).unref();
}

export function stopMailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ------------------------------------------------------------------ comparison

/** Exchange rates to INR from the currencies master (code → ₹ per unit). */
export async function inrRates(tx: Tx): Promise<Record<string, number>> {
  const c = masterTables.currencies;
  const rows = (await tx.select({ code: c.code, rate: c.exchangeRate }).from(c).where(isNull(c.deletedAt))) as { code: string; rate: string }[];
  const out: Record<string, number> = { INR: 1 };
  for (const r of rows) if (Number(r.rate) > 0) out[r.code.toUpperCase()] = Number(r.rate);
  return out;
}

/** Each conversation's latest quote, ranked best value first. */
export async function compare(tx: Tx, e: Enquiry, threads: Thread[]) {
  const ids = threads.map((t) => t.id);
  const quotes = ids.length ? await tx.select().from(freightQuotes).where(inArray(freightQuotes.threadId, ids)).orderBy(asc(freightQuotes.threadId), desc(freightQuotes.revision)) : [];
  const latest = new Map<string, Quote>();
  const first = new Map<string, Quote>();
  for (const q of quotes) {
    if (!latest.has(q.threadId)) latest.set(q.threadId, q);
    first.set(q.threadId, q); // ordered by revision desc → the last one seen is revision 1
  }
  const rates = await inrRates(tx);
  const warnings: string[] = [];
  if (!rates.USD) warnings.push('Add US Dollar (USD) with its exchange rate in Masters → Currencies so quotes can be compared in one currency.');
  const forRank: QuoteForRanking[] = [];
  for (const t of threads) {
    const q = latest.get(t.id);
    if (!q || t.status === 'REGRETTED') continue;
    if (!rates[q.currency]) warnings.push(`${t.carrier} quoted in ${q.currency}, which has no exchange rate in Masters → Currencies.`);
    forRank.push({ id: q.id, carrier: t.carrier, currency: q.currency, amount: q.amount, perContainer: q.perContainer, surcharges: q.surcharges, freeDays: q.freeDays, transitDays: q.transitDays, validUntil: q.validUntil });
  }
  const ranked = rates.USD ? rankQuotes(forRank, { containers: e.containerCount, inrPerUnit: rates, today: businessDate() }) : [];
  const usdInr = rates.USD ?? null;
  const rows = ranked.map((r) => {
    const q = quotes.find((x) => x.id === r.id)!;
    const opening = first.get(q.threadId);
    const openingUsd = opening && opening.id !== q.id ? rankQuotes([{ id: opening.id, carrier: r.carrier, currency: opening.currency, amount: opening.amount, perContainer: opening.perContainer, surcharges: opening.surcharges }], { containers: e.containerCount, inrPerUnit: rates, today: '0000-01-01' })[0].totalUsd : null;
    return {
      ...r,
      threadId: q.threadId,
      revision: q.revision,
      auto: q.auto,
      totalInr: usdInr ? Math.round(r.totalUsd * usdInr) : null,
      perContainerUsd: Math.round((r.totalUsd / Math.max(1, e.containerCount)) * 100) / 100,
      /** Negotiated down from the carrier's first quote (USD, whole enquiry). */
      negotiatedUsd: openingUsd != null ? Math.round((openingUsd - r.totalUsd) * 100) / 100 : null,
    };
  });
  return { rows, warnings: [...new Set(warnings)], usdInr };
}

/** The awarded freight as a ₹ charge on the shipment lot (replaces an earlier ocean freight line). */
export async function applyFreightToShipment(tx: Tx, e: Enquiry, carrier: string, q: Quote) {
  if (!e.shipmentId) return null;
  const rates = await inrRates(tx);
  const fx = rates[q.currency];
  if (!fx) throw badRequest(`No exchange rate for ${q.currency}`, `Add ${q.currency} with its exchange rate in Masters → Currencies, then award again.`);
  const [s] = await tx.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.id, e.shipmentId), isNull(shipments.deletedAt)));
  if (!s) return null;
  const heads = masterTables.chargeHeads;
  const [head] = (await tx.select({ id: heads.id, name: heads.name }).from(heads).where(and(sql`${heads.name} ilike '%freight%'`, isNull(heads.deletedAt))).orderBy(asc(heads.name)).limit(1)) as { id: string; name: string }[];
  const qty = q.perContainer ? String(Math.max(1, e.containerCount)) : '1';
  const rate = mul(add([q.amount, q.surcharges ?? '0']), String(fx), 2);
  const existing = await tx.select({ id: shipmentCharges.id, label: shipmentCharges.label, head: shipmentCharges.chargeHeadId, position: shipmentCharges.position }).from(shipmentCharges).where(eq(shipmentCharges.shipmentId, s.id));
  const old = existing.filter((c) => (head && c.head === head.id) || /^ocean freight/i.test(c.label));
  if (old.length) await tx.delete(shipmentCharges).where(inArray(shipmentCharges.id, old.map((c) => c.id)));
  const label = `Ocean freight — ${carrier} (${q.currency} ${q.amount}${q.perContainer ? '/cntr' : ''} @ ₹${fx})`.slice(0, 128);
  await tx.insert(shipmentCharges).values({ companyId: e.companyId, shipmentId: s.id, chargeHeadId: head?.id ?? null, label, qty, rate, amount: mul(qty, rate, 2), position: old[0]?.position ?? existing.length });
  return { shipmentId: s.id, label, amountInr: mul(qty, rate, 2) };
}
