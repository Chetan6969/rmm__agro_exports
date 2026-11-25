import { extractQuote, rankQuotes, renderTemplate, stripQuoted, tidyTemplateSpacing } from '@rmm/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, closeDb } from '../src/db/client.js';
import { freightThreads, mailAccounts } from '../src/db/schema/index.js';
import { sendDueReminders } from '../src/modules/freight/freight.service.js';
import { explain, setMailDriver, type MailDriver, type OutgoingMail } from '../src/modules/freight/mail.js';
import { Client, createSuperAdmin, makeApp, PASSWORD } from './helpers.js';

process.env.MAIL_SECRET_KEY ||= 'test-only-mail-secret-key';

/** In-memory mailbox: records what was sent, serves what the test drops into the inbox. */
const sent: OutgoingMail[] = [];
const inbox: { uid: number; source: Buffer }[] = [];
let failLogin = false;
const fake: MailDriver = {
  async verify(c) {
    if (failLogin) throw explain({ code: 'EAUTH', message: 'Invalid login' }, c, 'SMTP');
  },
  async send(_c, m) {
    sent.push(m);
  },
  async fetchNew(_c, state) {
    const fresh = state.uidValidity !== 'v1';
    const msgs = inbox.filter((m) => fresh || m.uid > state.lastUid);
    return { uidValidity: 'v1', lastUid: inbox.length ? inbox[inbox.length - 1].uid : 0, messages: msgs };
  },
};

const deliver = (o: { from: string; subject: string; body: string; inReplyTo?: string; messageId?: string }) => {
  const id = o.messageId ?? `<reply-${inbox.length + 1}-${Date.now()}@carrier.test>`;
  const raw = [
    `From: ${o.from}`,
    'To: ops@gmail.com',
    `Subject: ${o.subject}`,
    `Message-ID: ${id}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : null,
    o.inReplyTo ? `References: ${o.inReplyTo}` : null,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    o.body,
  ]
    .filter((l) => l !== null)
    .join('\r\n');
  inbox.push({ uid: inbox.length + 1, source: Buffer.from(raw) });
  return id;
};

let app: FastifyInstance;
let root: Client;
const ids: Record<string, string> = {};
let rootId = '';

beforeAll(async () => {
  setMailDriver(fake);
  app = await makeApp();
  await createSuperAdmin('fq-root');
  root = new Client(app);
  rootId = (await root.login('fq-root')).user.id;
  const co = (await root.ok('POST', '/masters/companies', { code: 'FQA', name: 'Freight Co', legalName: 'Freight Co Pvt Ltd' })).id;
  await root.ok('POST', '/auth/switch-company', { companyId: co });
  await root.post('/masters/currencies', { code: 'USD', name: 'US Dollar', exchangeRate: 84 });
  for (const [k, name, email, ports] of [
    ['maersk', 'Ravi', 'ravi@maersk.test', 'Mundra, Jebel Ali'],
    ['msc', 'Anita', 'anita@msc.test', ''],
    ['cma', 'Paul', 'paul@cma.test', 'Rotterdam, Antwerp'],
  ]) {
    ids[k] = (await root.ok('POST', '/masters/freightContacts', { name, email, partyType: 'Freight forwarder', companyName: k.toUpperCase(), ports })).id;
  }
});

afterAll(async () => {
  setMailDriver(null);
  await app.close();
  await closeDb();
});

describe('reading quotes from replies', () => {
  it('finds rate, free days, transit and validity, ignoring the quoted original', () => {
    const q = extractQuote('Dear Sir,\nWe can offer USD 1,250 per container all in.\n14 days free time at destination\nTransit time: 18 days\nValid till 31.12.2026\n\nOn Mon, 1 Dec 2026 ops wrote:\n> Please quote, last year USD 900', '2026-12-01');
    expect(q).toMatchObject({ currency: 'USD', amount: '1250', perContainer: true, freeDays: 14, transitDays: 18, validUntil: '2026-12-31' });
    expect(stripQuoted('ok\n> old')).toBe('ok');
    expect(extractQuote('Total lump sum USD 9000 for all containers', '2026-12-01').perContainer).toBe(false);
  });

  it('ranks by total cost first, then transit and free days, and drops expired quotes', () => {
    const r = rankQuotes(
      [
        { id: 'a', carrier: 'A', currency: 'USD', amount: '1000', perContainer: true, transitDays: 20, freeDays: 14 },
        { id: 'b', carrier: 'B', currency: 'INR', amount: '75600', perContainer: true, transitDays: 15, freeDays: 21 },
        { id: 'c', carrier: 'C', currency: 'USD', amount: '500', perContainer: true, validUntil: '2026-01-01' },
      ],
      { containers: 2, inrPerUnit: { USD: 84 }, today: '2026-12-01' },
    );
    expect(r.map((x) => x.id)).toEqual(['b', 'a', 'c']); // ₹75,600 = $900 < $1,000; C has expired
    expect(r[0]).toMatchObject({ totalUsd: 1800, saveVsNext: 200 });
    expect(r[2].expired).toBe(true);
  });
});

describe('mail template spacing', () => {
  it('keeps exactly one space around each placeholder', () => {
    expect(tidyTemplateSpacing('Dear  {{contact_name}},')).toBe('Dear {{contact_name}},');
    expect(tidyTemplateSpacing('Rate{{their_rate}}now  {{ pol }}   to {{pod}}.')).toBe('Rate {{their_rate}} now {{pol}} to {{pod}}.');
    expect(tidyTemplateSpacing('({{pol}})\n{{pod}}')).toBe('({{pol}})\n{{pod}}');
    expect(renderTemplate('From{{pol}}  to   {{pod}}', { pol: 'Mundra', pod: 'Jebel Ali' })).toBe('From Mundra to Jebel Ali');
  });
});

describe('freight quotations by email', () => {
  it('connects the user mailbox, keeping the app password encrypted and hidden', async () => {
    expect((await root.ok('GET', '/mail-account')).account).toBeNull();
    failLogin = true;
    const bad = await root.put('/mail-account', { email: 'ops@gmail.com', password: 'wrong' });
    expect(bad.status).toBe(400);
    expect(bad.body.hint).toMatch(/app password/i);
    failLogin = false;
    const acc = await root.ok('PUT', '/mail-account', { email: 'Ops@Gmail.com', password: 'abcd efgh ijkl mnop', displayName: 'Ops Desk' });
    expect(acc).toMatchObject({ email: 'ops@gmail.com', provider: 'gmail', smtpHost: 'smtp.gmail.com', imapHost: 'imap.gmail.com', status: 'ok' });
    expect(JSON.stringify(acc)).not.toContain('abcd');
    const sql = adminSql();
    try {
      const [row] = await drizzle(sql).select().from(mailAccounts).where(eq(mailAccounts.email, 'ops@gmail.com'));
      expect(row.passwordEnc).toMatch(/^v1\./);
      expect(row.passwordEnc).not.toContain('abcdefgh');
    } finally {
      await sql.end();
    }
    // only Google, Microsoft or Yahoo; server settings cannot be typed in
    expect((await root.put('/mail-account', { email: 'ops@gmail.com', provider: 'zoho' })).status).toBe(400);
    const ms = await root.ok('PUT', '/mail-account', { email: 'ops@gmail.com', provider: 'outlook', smtpHost: 'evil.example.com' });
    expect(ms).toMatchObject({ provider: 'outlook', smtpHost: 'smtp.office365.com', imapHost: 'outlook.office365.com' });
    // a company domain defaults to Google; saving again without a password keeps the saved one
    expect(await root.ok('PUT', '/mail-account', { email: 'ops@gmail.com', displayName: 'Ops', provider: 'gmail' })).toMatchObject({ smtpHost: 'smtp.gmail.com' });
  });

  it('sends a personal rate request to each contact, best-matching contacts first', async () => {
    const e = await root.ok('POST', '/freight/enquiries', { portOfLoading: 'Mundra', portOfDischarge: 'Jebel Ali', containerType: "20' FCL", containerCount: 5, commodity: 'Basmati rice', readyDate: '2026-12-20', freeDaysWanted: 14, replyBy: '2026-12-05' });
    ids.enquiry = e.id;
    ids.number = e.number;
    expect(e.number).toMatch(/FQA\/FQ\//);
    const contacts = await root.ok('GET', `/freight/enquiries/${e.id}/contacts`);
    expect(contacts[0]).toMatchObject({ email: 'ravi@maersk.test', reason: 'Quotes this route' });
    expect(contacts.find((c: { email: string }) => c.email === 'paul@cma.test').suggested).toBe(false);

    const tpl = (await root.ok('GET', '/freight/templates')).find((t: { kind: string }) => t.kind === 'Rate request');
    const res = await root.ok('POST', `/freight/enquiries/${e.id}/send`, { recipients: [{ contactId: ids.maersk }, { contactId: ids.msc }, { contactId: ids.cma }], subject: tpl.subject, body: tpl.body });
    expect(res.sent).toHaveLength(3);
    expect(sent).toHaveLength(3);
    expect(sent[0].subject).toContain(`[FQ ${e.number}]`);
    expect(sent[0].subject).toContain('Mundra to Jebel Ali');
    expect(sent[0].text).toContain('Dear Ravi');
    expect(sent[1].text).toContain('Dear Anita');
    expect(sent[0].text).toContain("5 × 20' FCL");
    // sending again to the same people is refused
    expect((await root.post(`/freight/enquiries/${e.id}/send`, { recipients: [{ contactId: ids.maersk }], subject: tpl.subject, body: tpl.body })).status).toBe(400);
  });

  it('fetches replies into the right conversation and reads the quote automatically', async () => {
    const maerskMail = sent.find((m) => m.to.address === 'ravi@maersk.test')!;
    deliver({ from: 'Ravi <ravi@maersk.test>', subject: `Re: ${maerskMail.subject}`, inReplyTo: maerskMail.messageId, body: 'Dear Sir,\nOur best rate is USD 950 per container.\n14 days free time\nTransit 18 days\nValid till 31.12.2026\n\nOn Tue ops wrote:\n> Please quote USD 1' });
    // no threading headers: matched by the [FQ ...] tag and the sender
    deliver({ from: 'anita@msc.test', subject: `Rates [FQ ${ids.number}]`, body: 'Ocean freight USD 1,050/cntr\n21 days free time\nTransit time 15 days' });
    deliver({ from: 'someone@else.test', subject: 'Lunch?', body: 'USD 5 sandwich' });
    const s1 = await root.ok('POST', '/mail-account/sync');
    expect(s1).toMatchObject({ checked: 3, matched: 2, quotes: 2 });
    // checking again stores nothing twice
    expect(await root.ok('POST', '/mail-account/sync')).toMatchObject({ matched: 0 });

    const e = await root.ok('GET', `/freight/enquiries/${ids.enquiry}`);
    const byCarrier = (c: string) => e.threads.find((t: { carrier: string }) => t.carrier === c);
    expect(byCarrier('MAERSK')).toMatchObject({ status: 'QUOTED', replies: 1, unread: 1 });
    expect(byCarrier('MAERSK').latestQuote).toMatchObject({ currency: 'USD', amount: '950.00', freeDays: 14, transitDays: 18, validUntil: '2026-12-31', auto: true });
    expect(byCarrier('CMA').status).toBe('SENT');
    expect(e.comparison.rows.map((r: { carrier: string }) => r.carrier)).toEqual(['MAERSK', 'MSC']);
    expect(e.comparison.rows[0]).toMatchObject({ totalUsd: 4750, saveVsNext: 500 });
    ids.maerskThread = byCarrier('MAERSK').id;
    ids.mscThread = byCarrier('MSC').id;
    ids.cmaThread = byCarrier('CMA').id;

    const thread = await root.ok('GET', `/freight/threads/${ids.maerskThread}`);
    expect(thread.messages.map((m: { direction: string }) => m.direction)).toEqual(['out', 'in']);
    expect(thread.unread).toBe(0);
  });

  it('reminds contacts who did not reply once their window has passed', async () => {
    expect(await sendDueReminders(rootId)).toBe(0); // too early
    const sql = adminSql();
    try {
      await drizzle(sql).update(freightThreads).set({ lastOutboundAt: new Date(Date.now() - 72 * 3600_000) }).where(eq(freightThreads.id, ids.cmaThread));
    } finally {
      await sql.end();
    }
    const before = sent.length;
    expect(await sendDueReminders(rootId)).toBe(1);
    expect(sent[before]).toMatchObject({ to: { address: 'paul@cma.test' } });
    expect(sent[before].subject).toContain(`[FQ ${ids.number}]`);
    expect(sent[before].inReplyTo).toBeTruthy();
  });

  it('negotiates in the same thread and re-ranks on the revised offer', async () => {
    const before = sent.length;
    await root.ok('POST', `/freight/threads/${ids.mscThread}/reply`, { subject: null, body: 'Dear {{contact_name}}, you quoted {{their_rate}}. Can you match {{target_rate}}?', targetRate: 'USD 900' });
    const counter = sent[before];
    expect(counter.text).toContain('you quoted USD 1,050 per container. Can you match USD 900?');
    expect(counter.subject).toMatch(/^Re: /);
    expect(counter.references?.length).toBeGreaterThan(0);

    deliver({ from: 'anita@msc.test', subject: `Re: ${counter.subject}`, inReplyTo: counter.messageId, body: 'Revised offer: USD 890 per container, rest same.' });
    expect(await root.ok('POST', '/mail-account/sync')).toMatchObject({ matched: 1, quotes: 1 });
    const e = await root.ok('GET', `/freight/enquiries/${ids.enquiry}`);
    const best = e.comparison.rows[0];
    expect(best).toMatchObject({ carrier: 'MSC', revision: 2, totalUsd: 4450, negotiatedUsd: 800 });
    expect(e.threads.find((t: { id: string }) => t.id === ids.mscThread).status).toBe('NEGOTIATING');

    // a user corrects an automatically read value: it becomes a new revision
    await root.ok('POST', `/freight/threads/${ids.mscThread}/quotes`, { currency: 'USD', amount: '890', perContainer: true, freeDays: 21, transitDays: 15 });
    const again = await root.ok('GET', `/freight/enquiries/${ids.enquiry}`);
    expect(again.comparison.rows[0]).toMatchObject({ carrier: 'MSC', revision: 3, auto: false, score: 100 });
  });

  it('awards the best offer, mails the winner and the others who quoted', async () => {
    const before = sent.length;
    const res = await root.ok('POST', `/freight/enquiries/${ids.enquiry}/award`, { threadId: ids.mscThread });
    expect(res.mailed.sort()).toEqual(['anita@msc.test', 'ravi@maersk.test']);
    expect(sent.slice(before).find((m) => m.to.address === 'anita@msc.test')!.subject).toMatch(/^Booking confirmation/);
    const e = await root.ok('GET', `/freight/enquiries/${ids.enquiry}`);
    expect(e.status).toBe('AWARDED');
    expect(e.threads.find((t: { id: string }) => t.id === ids.cmaThread).status).toBe('REGRETTED');
    expect((await root.post(`/freight/enquiries/${ids.enquiry}/award`, { threadId: ids.maerskThread })).status).toBe(409);
    const list = await root.ok('GET', '/freight/enquiries');
    expect(list.find((x: { id: string }) => x.id === ids.enquiry)).toMatchObject({ awardedTo: 'MSC', sent: 3, quoted: 2 });
  });

  it('needs the freight permission, and deleted enquiries go to the recycle bin', async () => {
    const role = (await root.ok('POST', '/roles', { name: 'No freight', permissions: ['master.products:view'] })).id;
    const me = await root.ok('GET', '/auth/me');
    await root.ok('POST', '/users', { username: 'fq-user', fullName: 'FQ User', password: PASSWORD, mustChangePassword: false, access: [{ companyId: me.activeCompany.id, roleIds: [role] }] });
    const u = new Client(app);
    await u.login('fq-user');
    expect((await u.get('/freight/enquiries')).status).toBe(403);

    await root.ok('DELETE', `/freight/enquiries/${ids.enquiry}`, { reason: 'Test cleanup' });
    expect((await root.get(`/freight/enquiries/${ids.enquiry}`)).status).toBe(404);
    const bin = await root.ok('GET', '/recycle-bin?type=freightEnquiries');
    expect(bin.rows[0]).toMatchObject({ title: ids.number, reason: 'Test cleanup' });
    await root.ok('POST', `/recycle-bin/freightEnquiries/${ids.enquiry}/restore`);
    expect((await root.get(`/freight/enquiries/${ids.enquiry}`)).status).toBe(200);
  });
});
