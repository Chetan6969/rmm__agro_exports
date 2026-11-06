import type { SessionCompany } from '@rmm/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { companies, rolePermissions, roles, userCompanyRoles } from '../db/schema/index.js';

/** Companies a user may switch into (super admins: every active company). */
export async function companiesForUser(tx: Executor, userId: string, isSuperAdmin: boolean): Promise<SessionCompany[]> {
  const base = tx
    .selectDistinct({ id: companies.id, code: companies.code, name: companies.name })
    .from(companies);
  const rows = isSuperAdmin
    ? await base.where(and(isNull(companies.deletedAt), eq(companies.isActive, true))).orderBy(asc(companies.name))
    : await base
        .innerJoin(userCompanyRoles, eq(userCompanyRoles.companyId, companies.id))
        .where(and(eq(userCompanyRoles.userId, userId), isNull(companies.deletedAt), eq(companies.isActive, true)))
        .orderBy(asc(companies.name));
  return rows as SessionCompany[];
}

/** Effective permission keys of a user inside one company (union of their roles there). */
export async function permissionsFor(tx: Executor, userId: string, companyId: string | null): Promise<Set<string>> {
  if (!companyId) return new Set();
  const rows = await tx
    .selectDistinct({ p: rolePermissions.permission })
    .from(userCompanyRoles)
    .innerJoin(roles, and(eq(roles.id, userCompanyRoles.roleId), isNull(roles.deletedAt)))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(and(eq(userCompanyRoles.userId, userId), eq(userCompanyRoles.companyId, companyId)));
  return new Set(rows.map((r) => r.p));
}

export async function isMember(tx: Executor, userId: string, companyIds: string[]): Promise<Set<string>> {
  if (!companyIds.length) return new Set();
  const rows = await tx
    .selectDistinct({ c: userCompanyRoles.companyId })
    .from(userCompanyRoles)
    .where(and(eq(userCompanyRoles.userId, userId), inArray(userCompanyRoles.companyId, companyIds)));
  return new Set(rows.map((r) => r.c));
}
