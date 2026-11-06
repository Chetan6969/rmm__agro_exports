import type { Executor } from '../db/client.js';
import { auditLogs } from '../db/schema/index.js';

const IGNORED = new Set(['id', 'companyId', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'version', 'passwordHash', 'deletedAt', 'deletedBy', 'deleteReason']);

/** Field-level diff: { field: [before, after] } for changed fields only. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const changes: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const a = before?.[k] ?? null;
    const b = after?.[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = [a, b];
  }
  return changes;
}

export interface AuditEntry {
  entity: string;
  action: string;
  recordId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
  /** Override the company recorded (defaults to the active company). */
  companyId?: string | null;
}

/** Write an audit row using the same executor (transaction) as the business change. */
export async function audit(tx: Executor, ctx: { userId: string | null; companyId: string | null; ip: string | null } | null, e: AuditEntry) {
  const changes = e.before !== undefined || e.after !== undefined ? diff(e.before ?? null, e.after ?? null) : null;
  await tx.insert(auditLogs).values({
    userId: ctx?.userId ?? null,
    companyId: e.companyId !== undefined ? e.companyId : (ctx?.companyId ?? null),
    entity: e.entity,
    recordId: e.recordId ?? null,
    action: e.action,
    changes: changes && Object.keys(changes).length ? changes : null,
    meta: e.meta ?? null,
    ip: ctx?.ip ?? null,
  });
}
