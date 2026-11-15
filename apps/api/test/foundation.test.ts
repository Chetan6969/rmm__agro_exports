import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '../src/db/client.js';
import { masterTables } from '../src/db/schema/index.js';
import { inCompanyTx, type RequestContext } from '../src/core/context.js';
import { allocateNumber } from '../src/modules/numbering.js';
import { Client, createSuperAdmin, makeApp, PASSWORD } from './helpers.js';

let app: FastifyInstance;
let root: Client, alice: Client, bob: Client, carol: Client;
const co: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' };
let docRole: string;
let users: Record<string, string> = {};

beforeAll(async () => {
  app = await makeApp();
  await createSuperAdmin('root');
  root = new Client(app);
  await root.login('root');

  for (const k of ['A', 'B', 'C'] as const) {
    const c = await root.ok('POST', '/masters/companies', { code: `CO${k}`, name: `Company ${k}`, legalName: `Company ${k} Pvt Ltd` });
    co[k] = c.id;
  }
  docRole = (
    await root.ok('POST', '/roles', {
      name: 'Doc exec',
      permissions: ['master.customers:view', 'master.customers:create', 'master.customers:edit', 'master.customers:delete', 'master.products:view'],
    })
  ).id;
  const mk = async (username: string, access: { companyId: string; roleIds: string[] }[]) => {
    const u = await root.ok('POST', '/users', { username, fullName: username, password: PASSWORD, mustChangePassword: false, access });
    users[username] = u.id;
  };
  await mk('alice', [{ companyId: co.A, roleIds: [docRole] }]);
  await mk('bob', [{ companyId: co.B, roleIds: [docRole] }]);
  await mk('carol', [
    { companyId: co.A, roleIds: [docRole] },
    { companyId: co.B, roleIds: [docRole] },
  ]);
  alice = new Client(app);
  bob = new Client(app);
  carol = new Client(app);
  await alice.login('alice');
  await bob.login('bob');
  await carol.login('carol');
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('authentication', () => {
  it('rejects wrong passwords and anonymous requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'nope' } });
    expect(res.statusCode).toBe(401);
    const anon = await app.inject({ method: 'GET', url: '/api/masters/customers' });
    expect(anon.statusCode).toBe(401);
  });

  it('session reports only member companies and their permissions', async () => {
    const me = (await alice.get('/auth/me')).body;
    expect(me.companies.map((c: { code: string }) => c.code)).toEqual(['COA']);
    expect(me.activeCompany.code).toBe('COA');
    expect(me.permissions).toContain('master.customers:create');
    expect(me.permissions).not.toContain('master.products:create');
  });

  it('cannot switch into a company without membership', async () => {
    expect((await alice.post('/auth/switch-company', { companyId: co.B })).status).toBe(403);
  });
});

describe('company isolation (RLS)', () => {
  let custA: string;

  it('a record created in A is invisible to B', async () => {
    custA = (await alice.ok('POST', '/masters/customers', { code: 'BUY1', name: 'Gulf Foods LLC' })).id;
    const list = (await bob.get('/masters/customers')).body;
    expect(list.rows).toHaveLength(0);
    expect((await bob.get(`/masters/customers/${custA}`)).status).toBe(404);
    expect((await bob.put(`/masters/customers/${custA}`, { name: 'hacked', version: 1 })).status).toBe(404);
    expect((await bob.del(`/masters/customers/${custA}`, { reason: 'x' })).status).toBe(404);
  });

  it('PostgreSQL itself hides other companies rows even for raw SQL', async () => {
    const t = masterTables.customers;
    const seenFromB = await inCompanyTx(co.B, (tx) => tx.select().from(t));
    expect(seenFromB).toHaveLength(0);
    const seenNoCompany = await inCompanyTx(null, (tx) => tx.select().from(t));
    expect(seenNoCompany).toHaveLength(0);
    await expect(
      inCompanyTx(co.B, (tx) => tx.insert(t).values({ companyId: co.A, name: 'smuggled' })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });

  it('client-supplied companyId is rejected', async () => {
    const r = await bob.post('/masters/customers', { name: 'x', companyId: co.A });
    expect(r.status).toBe(400);
  });

  it('carol sees A data only while A is active', async () => {
    await carol.ok('POST', '/auth/switch-company', { companyId: co.A });
    expect((await carol.get('/masters/customers')).body.total).toBe(1);
    await carol.ok('POST', '/auth/switch-company', { companyId: co.B });
    expect((await carol.get('/masters/customers')).body.total).toBe(0);
  });

  it('codes are unique per company, not globally', async () => {
    expect((await alice.post('/masters/customers', { code: 'BUY1', name: 'Dupe' })).status).toBe(409);
    expect((await bob.post('/masters/customers', { code: 'buy1', name: 'Same code in B' })).status).toBe(201);
  });
});

describe('data sharing policies', () => {
  let c1: string, c2: string, policy: string;

  beforeAll(async () => {
    c1 = (await alice.ok('POST', '/masters/customers', { code: 'SH1', name: 'Shared One' })).id;
    c2 = (await alice.ok('POST', '/masters/customers', { code: 'SH2', name: 'Shared Two' })).id;
    await root.ok('POST', '/auth/switch-company', { companyId: co.A });
  });

  it('read share: B sees A customers, flagged as shared, but cannot edit or delete', async () => {
    policy = (await root.ok('POST', '/sharing', { entity: 'customers', targetCompanyId: co.B, access: 'read' })).id;
    const list = (await bob.get('/masters/customers?ownership=shared')).body;
    expect(list.rows.map((r: { code: string }) => r.code).sort()).toEqual(['BUY1', 'SH1', 'SH2']);
    expect(list.rows.every((r: { _shared: boolean; _ownerCode: string }) => r._shared && r._ownerCode === 'COA')).toBe(true);
    const row = (await bob.get(`/masters/customers/${c1}`)).body;
    expect((await bob.put(`/masters/customers/${c1}`, { name: 'edit', version: row.version })).status).toBe(403);
    // C was not given anything
    await root.ok('POST', '/auth/switch-company', { companyId: co.C });
    expect((await root.get('/masters/customers')).body.total).toBe(0);
    await root.ok('POST', '/auth/switch-company', { companyId: co.A });
  });

  it('write share: B can edit, still not delete', async () => {
    await root.ok('PUT', `/sharing/${policy}`, { access: 'write', recordIds: null });
    const row = (await bob.get(`/masters/customers/${c1}`)).body;
    const upd = await bob.put(`/masters/customers/${c1}`, { city: 'Dubai', version: row.version });
    expect(upd.status).toBe(200);
    expect(upd.body.city).toBe('Dubai');
    expect((await bob.del(`/masters/customers/${c1}`, { reason: 'no' })).status).toBe(403);
  });

  it('record-level share: only listed records are visible', async () => {
    await root.ok('PUT', `/sharing/${policy}`, { access: 'read', recordIds: [c2] });
    const list = (await bob.get('/masters/customers?ownership=shared')).body;
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual([c2]);
    expect((await bob.get(`/masters/customers/${c1}`)).status).toBe(404);
  });

  it('removing the policy removes access immediately', async () => {
    await root.ok('DELETE', `/sharing/${policy}`);
    expect((await bob.get('/masters/customers?ownership=shared')).body.total).toBe(0);
  });

  it('non-shareable masters cannot get policies; others cannot share A data', async () => {
    expect((await root.post('/sharing', { entity: 'bankAccounts', targetCompanyId: co.B })).status).toBe(400);
    expect((await alice.post('/sharing', { entity: 'customers', targetCompanyId: co.B })).status).toBe(403);
  });
});

describe('RBAC', () => {
  it('blocks actions outside the role', async () => {
    expect((await alice.post('/masters/products', { name: 'Rice' })).status).toBe(403);
    expect((await alice.get('/masters/products')).status).toBe(200);
    expect((await alice.get('/users')).status).toBe(403);
    expect((await alice.post('/roles', { name: 'x', permissions: [] })).status).toBe(403);
  });

  it('role changes apply to open sessions on the next request', async () => {
    const role = (await root.get('/roles')).body.find((r: { id: string }) => r.id === docRole);
    await root.ok('PUT', `/roles/${docRole}`, { name: role.name, permissions: [...role.permissions, 'master.products:create'], version: role.version });
    expect((await alice.post('/masters/products', { name: '1121 Steam Basmati' })).status).toBe(201);
  });

  it('a sub-admin cannot grant permissions they do not have', async () => {
    const lite = await root.ok('POST', '/roles', {
      name: 'Lite admin',
      permissions: ['admin.roles:view', 'admin.roles:create', 'master.customers:view'],
    });
    await root.ok('PUT', `/users/${users.alice}/access`, { access: [{ companyId: co.A, roleIds: [docRole, lite.id] }] });
    const escalate = await alice.post('/roles', { name: 'Evil', permissions: ['admin.users:delete'] });
    expect(escalate.status).toBe(403);
    const fine = await alice.post('/roles', { name: 'Viewer2', permissions: ['master.customers:view'] });
    expect(fine.status).toBe(201);
  });

  it('only super admins create super admins or companies', async () => {
    const r = await root.ok('POST', '/roles', { name: 'User admin', permissions: ['admin.users:view', 'admin.users:create', 'admin.users:edit'] });
    await root.ok('PUT', `/users/${users.bob}/access`, { access: [{ companyId: co.B, roleIds: [docRole, r.id] }] });
    const res = await bob.post('/users', { username: 'mallory', fullName: 'M', password: PASSWORD, isSuperAdmin: true });
    expect(res.status).toBe(403);
    // bob cannot assign roles in company A where he is not an admin
    const res2 = await bob.post('/users', { username: 'dave', fullName: 'D', password: PASSWORD, access: [{ companyId: co.A, roleIds: [docRole] }] });
    expect(res2.status).toBe(403);
    expect((await bob.post('/masters/companies', { code: 'X', name: 'X', legalName: 'X' })).status).toBe(403);
  });

  it('revoking membership cuts access on the next request', async () => {
    await root.ok('PUT', `/users/${users.carol}/access`, { access: [{ companyId: co.B, roleIds: [docRole] }] });
    await carol.ok('POST', '/auth/switch-company', { companyId: co.B });
    await root.ok('PUT', `/users/${users.carol}/access`, { access: [] });
    const r = await carol.get('/masters/customers');
    expect(r.status).toBe(403);
  });
});

describe('record integrity', () => {
  it('optimistic concurrency rejects stale updates', async () => {
    const c = await alice.ok('POST', '/masters/customers', { name: 'Concurrent' });
    expect((await alice.put(`/masters/customers/${c.id}`, { city: 'A', version: 1 })).status).toBe(200);
    const stale = await alice.put(`/masters/customers/${c.id}`, { city: 'B', version: 1 });
    expect(stale.status).toBe(409);
  });

  it('validates fields from the registry', async () => {
    const r = await alice.post('/masters/customers', { name: '', email: 'not-an-email', incoterm: 'XYZ' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fields).sort()).toEqual(['email', 'incoterm', 'name']);
  });

  it('company short code rejects document patterns like RMM/EX/26-27', async () => {
    const bad = await root.post('/masters/companies', { code: 'RMM/EX/26-27', name: 'X', legalName: 'X' });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.code).toMatch(/no "\/"/);
    expect((await root.post('/masters/companies', { code: 'rmm-2', name: 'Y', legalName: 'Y' })).status).toBe(201);
  });

  it('soft delete needs a reason and hides the record', async () => {
    const c = await alice.ok('POST', '/masters/customers', { name: 'To delete' });
    expect((await alice.del(`/masters/customers/${c.id}`, {})).status).toBe(400);
    await alice.ok('DELETE', `/masters/customers/${c.id}`, { reason: 'duplicate entry' });
    expect((await alice.get(`/masters/customers/${c.id}`)).status).toBe(404);
  });

  it('audit log records field-level changes and is append-only', async () => {
    const c = await alice.ok('POST', '/masters/customers', { name: 'Audited' });
    await alice.ok('PUT', `/masters/customers/${c.id}`, { city: 'Riyadh', version: c.version });
    const logs = (await root.get(`/audit?entity=customers&recordId=${c.id}`)).body.rows;
    expect(logs.map((l: { action: string }) => l.action)).toEqual(['update', 'create']);
    expect(logs[0].changes).toEqual({ city: [null, 'Riyadh'] });
    expect(logs[0].username).toBe('alice');
    await expect(db().execute(sql`delete from audit_logs`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/permission denied/) },
    });
  });

  it('CSV export escapes formulas', async () => {
    await alice.ok('POST', '/masters/customers', { name: '=HYPERLINK("x")' });
    const role = (await root.get('/roles')).body.find((r: { id: string }) => r.id === docRole);
    await root.ok('PUT', `/roles/${docRole}`, { name: role.name, permissions: [...role.permissions, 'master.customers:export'], version: role.version });
    const r = await alice.req('GET', '/masters/customers/export');
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain(`'=HYPERLINK`);
  });
});

describe('document numbering', () => {
  const ctxFor = (companyId: string): RequestContext => ({
    userId: users.alice,
    sessionId: '',
    username: 'alice',
    isSuperAdmin: false,
    companyId,
    permissions: new Set(),
    ip: '127.0.0.1',
  });

  it('is sequential per company and financial year', async () => {
    const run = (c: string, d: string) => inCompanyTx(c, (tx) => allocateNumber(tx, ctxFor(c), 'commercial_invoice', d));
    expect(await run(co.A, '2026-05-10')).toBe('COA/EX/26-27/001');
    expect(await run(co.A, '2026-05-11')).toBe('COA/EX/26-27/002');
    expect(await run(co.B, '2026-05-11')).toBe('COB/EX/26-27/001');
    expect(await run(co.A, '2027-04-01')).toBe('COA/EX/27-28/001');
    expect(await run(co.A, '2027-03-31')).toBe('COA/EX/26-27/003');
  });

  it('a rolled-back transaction does not burn a number (gap-free)', async () => {
    await expect(
      inCompanyTx(co.C, async (tx) => {
        await allocateNumber(tx, ctxFor(co.C), 'proforma_invoice', '2026-06-01');
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');
    expect(await inCompanyTx(co.C, (tx) => allocateNumber(tx, ctxFor(co.C), 'proforma_invoice', '2026-06-01'))).toBe('PI-COC/26-27/001');
  });

  it('parallel saves never get the same number', async () => {
    const nums = await Promise.all(
      Array.from({ length: 25 }, () => inCompanyTx(co.B, (tx) => allocateNumber(tx, ctxFor(co.B), 'payment_receipt', '2026-07-01'))),
    );
    expect(new Set(nums).size).toBe(25);
    expect(nums.map((n) => Number(n.split('/').pop())).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('admins can change the pattern and continue from an Excel number, never backwards', async () => {
    await root.ok('POST', '/auth/switch-company', { companyId: co.A });
    await root.ok('PUT', '/numbering/purchase_order', { pattern: '{CO}/PO/{SEQ:4}', resetYearly: false, nextSeq: 46 });
    const list = (await root.get('/numbering')).body;
    expect(list.find((x: { docType: string }) => x.docType === 'purchase_order').nextNumber).toBe('COA/PO/0046');
    await inCompanyTx(co.A, (tx) => allocateNumber(tx, ctxFor(co.A), 'purchase_order', '2026-08-01'));
    expect((await root.put('/numbering/purchase_order', { pattern: '{CO}/PO/{SEQ:4}', resetYearly: false, nextSeq: 10 })).status).toBe(400);
    expect((await root.put('/numbering/purchase_order', { pattern: 'NO-SEQ', resetYearly: false })).status).toBe(400);
  });
});

describe('files and defaults', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = (client: Client, buf: Buffer, name: string, scope = '') => {
    const boundary = '----t';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),
      buf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'POST',
      url: `/api/files${scope}`,
      headers: { cookie: client.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  };

  it('accepts real images for company branding and rejects disguised files', async () => {
    const ok = await upload(root, png, 'seal.png', '?scope=group');
    expect(ok.statusCode).toBe(201);
    const fileId = ok.json().id;
    const company = (await root.get(`/masters/companies/${co.A}`)).body;
    const upd = await root.put(`/masters/companies/${co.A}`, { sealFileId: fileId, version: company.version });
    expect(upd.status).toBe(200);
    const evil = await upload(root, Buffer.from('<svg onload=alert(1)>'), 'x.png', '?scope=group');
    expect(evil.statusCode).toBe(400);
    expect((await upload(alice, png, 'logo.png', '?scope=group')).statusCode).toBe(403);
  });

  it('per-company defaults prefill forms without leaking across companies', async () => {
    await root.ok('POST', '/auth/switch-company', { companyId: co.A });
    await root.ok('PUT', '/defaults/customers', { values: { incoterm: 'CIF', city: 'Dubai' } });
    expect((await alice.get('/defaults/customers')).body.values).toMatchObject({ incoterm: 'CIF', city: 'Dubai', isActive: true });
    expect((await bob.get('/defaults/customers')).body.values.incoterm).toBeUndefined();
  });
});
