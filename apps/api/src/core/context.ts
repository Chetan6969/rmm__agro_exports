import { type Action, MODULE_MAP } from '@rmm/shared';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { db, type Tx } from '../db/client.js';
import { forbidden, HINTS, unauthorized } from './errors.js';

export interface RequestContext {
  userId: string;
  sessionId: string;
  username: string;
  isSuperAdmin: boolean;
  companyId: string | null;
  permissions: Set<string>;
  ip: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext | null;
  }
}

export function requireCtx(req: FastifyRequest): RequestContext {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}

export function requireCompany(ctx: RequestContext): string {
  if (!ctx.companyId) throw forbidden('No company is selected', HINTS.selectCompany);
  return ctx.companyId;
}

export function can(ctx: RequestContext, module: string, action: Action): boolean {
  return ctx.isSuperAdmin || ctx.permissions.has(`${module}:${action}`);
}

export function requirePerm(ctx: RequestContext, module: string, action: Action) {
  if (!can(ctx, module, action)) {
    const label = MODULE_MAP[module]?.label ?? module;
    throw forbidden(
      `You do not have the "${action}" permission for ${label}`,
      `Ask an administrator to tick "${action}" for ${label} in your role (Administration → Roles & permissions). It applies on your next click.`,
    );
  }
}

/**
 * Run work in one transaction scoped to the caller's active company.
 * RLS policies read app.company_id, so every query inside is isolated by PostgreSQL itself.
 * Business writes + their audit rows commit (or roll back) together.
 */
export async function inTenantTx<T>(ctx: RequestContext | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.company_id', ${ctx?.companyId ?? ''}, true), set_config('app.user_id', ${ctx?.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/** Run a transaction as a specific company (used when acting on behalf of another company, e.g. setup). */
export async function inCompanyTx<T>(companyId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId ?? ''}, true)`);
    return fn(tx);
  });
}
