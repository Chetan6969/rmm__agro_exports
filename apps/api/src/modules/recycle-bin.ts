/**
 * Recycle bin. Nothing in the ERP is ever erased: deleting marks a record deleted (who, when,
 * why) and it stays here for good. Each kind of record is listed only to users who may view it,
 * and restored only by users who may delete it — with the same checks as saving it (codes and
 * numbers still free, parent documents present, quantities within balance).
 */
import { DOC_LIST, ENTITY_LIST, getDoc, getEntity, type EntityDef } from '@rmm/shared';
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { audit } from '../core/audit.js';
import { can, inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../core/context.js';
import { badRequest, conflict, forbidden, notFound } from '../core/errors.js';
import type { Tx } from '../db/client.js';
import { docTables, masterTables, payments, roles, sharingPolicies, shipments, users, type AnyTable } from '../db/schema/index.js';
import { restoreDocument } from './documents/documents.service.js';

type Row = Record<string, unknown>;

interface Source {
  type: string;
  label: string;
  group: string;
  /** Permission module: view to see it here, delete to restore it. */
  module: string;
  table: AnyTable;
  title: SQL;
  sub?: SQL;
  hasReason: boolean;
  /** Extra visibility rule for tables without company RLS. */
  scope?: (ctx: RequestContext) => SQL | undefined;
  superAdminOnly?: boolean;
  restore: (tx: Tx, ctx: RequestContext, id: string) => Promise<unknown>;
}

const entities = ENTITY_LIST as readonly EntityDef[];

async function restoreMaster(tx: Tx, ctx: RequestContext, key: string, id: string) {
  const def = getEntity(key)!;
  const t = masterTables[key];
  const [row] = (await tx.select().from(t).where(and(eq(t.id, id), isNotNull(t.deletedAt)))) as Row[];
  if (!row) throw notFound('Deleted record not found', 'It may already have been restored. Reload the recycle bin.');
  if (def.scope === 'company' && row.companyId !== ctx.companyId) {
    throw forbidden('Only the owning company can restore this record', 'Switch to the company that owns it (Alt+C).');
  }
  for (const f of def.fields.filter((x) => x.unique && row[x.name] !== null && row[x.name] !== undefined)) {
    const conds = [eq(t[f.name], row[f.name] as string), isNull(t.deletedAt), ne(t.id, id)];
    if (def.scope === 'company') conds.push(eq(t.companyId, row.companyId as string));
    const [clash] = await tx.select({ id: t.id }).from(t).where(and(...conds)).limit(1);
    if (clash) throw conflict(`${f.label} "${row[f.name]}" is already used by another ${def.label.toLowerCase()}`, `Change the ${f.label.toLowerCase()} of the other record first, then restore this one.`);
  }
  await tx.update(t).set({ deletedAt: null, deletedBy: null, deleteReason: null, isActive: true, version: sql`${t.version} + 1`, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(t.id, id));
  await audit(tx, ctx, { entity: key, recordId: id, action: 'restore' });
}

const sources: Source[] = [
  ...DOC_LIST.map(
    (d): Source => ({
      type: d.key,
      label: d.label,
      group: 'Sales documents',
      module: d.module,
      table: docTables[d.key].header,
      title: sql`${docTables[d.key].header.documentNumber}`,
      sub: sql`to_char(${docTables[d.key].header.documentDate}, 'DD Mon YYYY')`,
      hasReason: true,
      restore: (tx, ctx, id) => restoreDocument(tx, ctx, d.key, id),
    }),
  ),
  {
    type: 'shipments',
    label: 'Shipment lot',
    group: 'Sales documents',
    module: 'sales.shipments',
    table: shipments,
    title: sql`'Lot ' || ${shipments.lotNo} || coalesce(' · ' || (select pi.document_number from proforma_invoices pi where pi.id = ${shipments.proformaInvoiceId}), '')`,
    sub: sql`${shipments.market} || ' · ' || ${shipments.quantityMt} || ' MT'`,
    hasReason: true,
    restore: async (tx, ctx, id) => {
      const [s] = (await tx.select().from(shipments).where(and(eq(shipments.id, id), isNotNull(shipments.deletedAt)))) as Row[];
      if (!s) throw notFound('Deleted lot not found', 'Reload the recycle bin.');
      const pi = docTables.proformaInvoices.header;
      const [order] = await tx.select({ id: pi.id }).from(pi).where(and(eq(pi.id, s.proformaInvoiceId as string), isNull(pi.deletedAt)));
      if (!order) throw badRequest('Restore its proforma invoice first', 'This lot belongs to a deleted order; bring the order back from the recycle bin first.');
      await tx.update(shipments).set({ deletedAt: null, deletedBy: null, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(shipments.id, id));
      await audit(tx, ctx, { entity: 'shipments', recordId: id, action: 'restore' });
    },
  },
  {
    type: 'payments',
    label: 'Payment receipt',
    group: 'Sales documents',
    module: 'sales.payments',
    table: payments,
    title: sql`${payments.amount}::text || coalesce(' · ' || ${payments.reference}, '')`,
    sub: sql`coalesce((select ci.document_number from commercial_invoices ci where ci.id = ${payments.commercialInvoiceId}), '') || ' · ' || to_char(${payments.paymentDate}, 'DD Mon YYYY')`,
    hasReason: false,
    restore: async (tx, ctx, id) => {
      const [p] = (await tx.select().from(payments).where(and(eq(payments.id, id), isNotNull(payments.deletedAt)))) as Row[];
      if (!p) throw notFound('Deleted payment not found', 'Reload the recycle bin.');
      const ci = docTables.commercialInvoices.header;
      const [inv] = await tx.select({ id: ci.id }).from(ci).where(and(eq(ci.id, p.commercialInvoiceId as string), isNull(ci.deletedAt)));
      if (!inv) throw badRequest('Restore its commercial invoice first', 'This receipt belongs to a deleted invoice; bring the invoice back first.');
      await tx.update(payments).set({ deletedAt: null, deletedBy: null, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(payments.id, id));
      await audit(tx, ctx, { entity: 'payments', recordId: id, action: 'restore' });
    },
  },
  ...entities.map(
    (e): Source => ({
      type: e.key,
      label: e.label,
      group: e.scope === 'group' ? 'Administration' : `Masters · ${e.menu}`,
      module: `master.${e.key}`,
      table: masterTables[e.key],
      title: sql`${masterTables[e.key][e.displayField]}::text`,
      sub: e.fields.some((f) => f.name === 'code') && e.displayField !== 'code' ? sql`${masterTables[e.key].code}::text` : undefined,
      hasReason: true,
      superAdminOnly: e.scope === 'group',
      restore: (tx, ctx, id) => restoreMaster(tx, ctx, e.key, id),
    }),
  ),
  {
    type: 'users',
    label: 'User',
    group: 'Administration',
    module: 'admin.users',
    table: users,
    title: sql`${users.username}`,
    sub: sql`${users.fullName}`,
    hasReason: true,
    // users are group-wide: admins see deleted users of their active company, super admins all
    scope: (ctx) => (ctx.isSuperAdmin ? undefined : sql`exists (select 1 from user_company_roles m where m.user_id = ${users.id} and m.company_id = ${ctx.companyId})`),
    restore: async (tx, ctx, id) => {
      const [u] = (await tx.select().from(users).where(and(eq(users.id, id), isNotNull(users.deletedAt)))) as Row[];
      if (!u) throw notFound('Deleted user not found', 'Reload the recycle bin.');
      if (!ctx.isSuperAdmin) {
        if (u.isSuperAdmin) throw forbidden('Only a super admin can restore a super admin');
        const [m] = await tx.execute(sql`select 1 from user_company_roles where user_id = ${id} and company_id = ${ctx.companyId} limit 1`);
        if (!m) throw forbidden('This user did not work in your company', 'Ask a super admin to restore them.');
      }
      const [clash] = await tx.select({ id: users.id }).from(users).where(and(sql`lower(${users.username}) = lower(${u.username as string})`, isNull(users.deletedAt))).limit(1);
      if (clash) throw conflict(`Username "${u.username}" is taken by another user`, 'Rename the other user first, then restore this one.');
      await tx.update(users).set({ deletedAt: null, deletedBy: null, deleteReason: null, isActive: true, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(users.id, id));
      await audit(tx, ctx, { entity: 'users', recordId: id, action: 'restore', meta: { username: u.username } });
    },
  },
  {
    type: 'roles',
    label: 'Role',
    group: 'Administration',
    module: 'admin.roles',
    table: roles,
    title: sql`${roles.name}`,
    sub: sql`${roles.description}`,
    hasReason: false,
    restore: async (tx, ctx, id) => {
      const [r] = (await tx.select().from(roles).where(and(eq(roles.id, id), isNotNull(roles.deletedAt)))) as Row[];
      if (!r) throw notFound('Deleted role not found', 'Reload the recycle bin.');
      const [clash] = await tx.select({ id: roles.id }).from(roles).where(and(sql`lower(${roles.name}) = lower(${r.name as string})`, isNull(roles.deletedAt))).limit(1);
      if (clash) throw conflict(`A role named "${r.name}" already exists`, 'Rename the other role first, then restore this one.');
      await tx.update(roles).set({ deletedAt: null, deletedBy: null, updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(roles.id, id));
      await audit(tx, ctx, { entity: 'roles', recordId: id, action: 'restore', meta: { name: r.name } });
    },
  },
  {
    type: 'sharing',
    label: 'Sharing policy',
    group: 'Administration',
    module: 'admin.sharing',
    table: sharingPolicies,
    title: sql`${sharingPolicies.entity} || ': ' || (select code from companies c where c.id = ${sharingPolicies.sourceCompanyId}) || ' → ' || (select code from companies c where c.id = ${sharingPolicies.targetCompanyId})`,
    sub: sql`${sharingPolicies.access}`,
    hasReason: true,
    scope: (ctx) => (ctx.isSuperAdmin ? undefined : or(eq(sharingPolicies.sourceCompanyId, ctx.companyId!), eq(sharingPolicies.targetCompanyId, ctx.companyId!))),
    restore: async (tx, ctx, id) => {
      const [p] = (await tx.select().from(sharingPolicies).where(and(eq(sharingPolicies.id, id), isNotNull(sharingPolicies.deletedAt)))) as Row[];
      if (!p) throw notFound('Deleted policy not found', 'Reload the recycle bin.');
      if (!ctx.isSuperAdmin && p.sourceCompanyId !== ctx.companyId) throw forbidden('Only the company that shares the data can restore this policy', 'Switch to that company (Alt+C).');
      const [clash] = await tx
        .select({ id: sharingPolicies.id })
        .from(sharingPolicies)
        .where(and(eq(sharingPolicies.entity, p.entity as string), eq(sharingPolicies.sourceCompanyId, p.sourceCompanyId as string), eq(sharingPolicies.targetCompanyId, p.targetCompanyId as string), isNull(sharingPolicies.deletedAt)))
        .limit(1);
      if (clash) throw conflict('A policy for this master and these companies already exists', 'Edit the existing policy instead (Administration → Data sharing).');
      await tx.update(sharingPolicies).set({ deletedAt: null, deletedBy: null, deleteReason: null, updatedAt: new Date() }).where(eq(sharingPolicies.id, id));
      await audit(tx, ctx, { entity: 'sharing_policies', recordId: id, action: 'restore' });
    },
  },
];

const visible = (ctx: RequestContext) => sources.filter((s) => (!s.superAdminOnly || ctx.isSuperAdmin) && can(ctx, s.module, 'view'));

export interface BinQuery {
  type?: string;
  group?: string;
  from?: string;
  to?: string;
  deletedBy?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const isUuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

function conditions(s: Source, ctx: RequestContext, q: BinQuery): SQL {
  const t = s.table;
  const c: SQL[] = [isNotNull(t.deletedAt)];
  const scope = s.scope?.(ctx);
  if (scope) c.push(scope);
  const from = isDate(q.from);
  const to = isDate(q.to);
  if (from) c.push(gte(t.deletedAt, new Date(`${from}T00:00:00+05:30`)));
  if (to) c.push(lte(t.deletedAt, new Date(`${to}T23:59:59.999+05:30`)));
  const by = isUuid(q.deletedBy);
  if (by) c.push(eq(t.deletedBy, by));
  const term = q.search?.trim();
  if (term) {
    const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
    const hay = [ilike(sql`(${s.title})`, like), ...(s.sub ? [ilike(sql`(${s.sub})`, like)] : []), ...(s.hasReason ? [ilike(t.deleteReason, like)] : [])];
    c.push(or(...hay)!);
  }
  return and(...c)!;
}

export async function listBin(tx: Tx, ctx: RequestContext, q: BinQuery) {
  requireCompany(ctx);
  const all = visible(ctx);
  const chosen = all.filter((s) => (!q.type || s.type === q.type) && (!q.group || s.group === q.group));
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 200);
  const page = Math.max(Number(q.page) || 1, 1);

  // counts per type (all filters except the type itself), for the type filter
  const counts: { type: string; label: string; group: string; count: number }[] = [];
  for (const s of all) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.table).where(conditions(s, ctx, { ...q, type: undefined, group: undefined }));
    if (n) counts.push({ type: s.type, label: s.label, group: s.group, count: n });
  }

  const rows: Row[] = [];
  for (const s of chosen) {
    const t = s.table;
    const got = (await tx
      .select({
        id: t.id,
        title: s.title,
        sub: s.sub ?? sql<string | null>`null`,
        deletedAt: t.deletedAt,
        deletedBy: t.deletedBy,
        reason: s.hasReason ? t.deleteReason : sql<string | null>`null`,
      })
      .from(t)
      .where(conditions(s, ctx, q))
      .orderBy(desc(t.deletedAt))
      .limit(page * pageSize)) as Row[];
    for (const r of got) rows.push({ ...r, type: s.type, typeLabel: s.label, group: s.group, canRestore: can(ctx, s.module, 'delete') && (!s.superAdminOnly || ctx.isSuperAdmin) });
  }
  rows.sort((a, b) => +new Date(b.deletedAt as string) - +new Date(a.deletedAt as string));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const total = chosen.reduce((a, s) => a + (counts.find((c) => c.type === s.type)?.count ?? 0), 0);

  // names of the people who deleted (for display and the "deleted by" filter)
  const who = new Map<string, string>();
  const deleterIds = [...new Set(rows.map((r) => r.deletedBy).filter((x): x is string => typeof x === 'string'))];
  if (deleterIds.length) for (const u of await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, deleterIds))) who.set(u.id, u.name);
  for (const r of pageRows) r.deletedByName = r.deletedBy ? (who.get(r.deletedBy as string) ?? 'Unknown user') : null;
  const deleters = await tx.execute(
    sql`select distinct u.id, u.full_name as name from users u where u.id in (${sql.join(
      all.map((s) => sql`select ${s.table.deletedBy} from ${s.table} where ${s.table.deletedAt} is not null`),
      sql` union `,
    )}) order by 2`,
  );

  return { rows: pageRows, total, page, pageSize, counts, deleters, groups: [...new Set(all.map((s) => s.group))] };
}

export async function recycleBinRoutes(app: FastifyInstance) {
  app.get<{ Querystring: BinQuery }>('/recycle-bin', async (req) => {
    const ctx = requireCtx(req);
    return inTenantTx(ctx, (tx) => listBin(tx, ctx, req.query));
  });

  app.post<{ Params: { type: string; id: string } }>('/recycle-bin/:type/:id/restore', async (req) => {
    const ctx = requireCtx(req);
    requireCompany(ctx);
    const s = sources.find((x) => x.type === req.params.type);
    if (!s) throw notFound(`Unknown record type "${req.params.type}"`, 'Reload the recycle bin.');
    if (s.superAdminOnly && !ctx.isSuperAdmin) throw forbidden('Only a super admin can restore companies');
    requirePerm(ctx, s.module, 'delete');
    if (!isUuid(req.params.id)) throw notFound();
    await inTenantTx(ctx, (tx) => s.restore(tx, ctx, req.params.id));
    return { ok: true, type: s.type, label: getDoc(s.type)?.label ?? s.label };
  });
}
