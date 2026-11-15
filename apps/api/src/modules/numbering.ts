import { businessDate, DOC_TYPES, financialYear, formatDocNumber, validatePattern } from '@rmm/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../db/client.js';
import { companies, numberCounters, numberSeries } from '../db/schema/index.js';
import { audit } from '../core/audit.js';
import { inTenantTx, requireCompany, requireCtx, requirePerm, type RequestContext } from '../core/context.js';
import { badRequest, notFound } from '../core/errors.js';

const docType = (key: string) => {
  const d = DOC_TYPES.find((x) => x.key === key);
  if (!d) throw notFound(`Unknown document type ${key}`, 'Open Administration → Document numbering and pick the series from the list.');
  return d;
};

async function seriesFor(tx: Tx, companyId: string, key: string) {
  const d = docType(key);
  const [s] = await tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.companyId, companyId), eq(numberSeries.docType, key)));
  const [co] = await tx.select({ code: companies.code, fyStartMonth: companies.fyStartMonth }).from(companies).where(eq(companies.id, companyId));
  return {
    pattern: s?.pattern ?? d.defaultPattern,
    resetYearly: s?.resetYearly ?? d.resetYearly,
    companyCode: co.code as string,
    fyStartMonth: (co.fyStartMonth as number | null) ?? 4,
  };
}

const periodOf = (date: string, resetYearly: boolean, fyStartMonth: number) =>
  resetYearly ? financialYear(date, fyStartMonth).startYear : 0;

/**
 * Allocate the next number for a document INSIDE the caller's business transaction.
 * The counter row is locked by the upsert until commit; a rollback releases the number,
 * so the sequence stays gap-free per company / doc type / financial year.
 */
export async function allocateNumber(tx: Tx, ctx: RequestContext, key: string, docDate: string): Promise<string> {
  const companyId = requireCompany(ctx);
  const s = await seriesFor(tx, companyId, key);
  const period = periodOf(docDate, s.resetYearly, s.fyStartMonth);
  const [row] = await tx
    .insert(numberCounters)
    .values({ companyId, docType: key, period, lastValue: 1 })
    .onConflictDoUpdate({
      target: [numberCounters.companyId, numberCounters.docType, numberCounters.period],
      set: { lastValue: sql`${numberCounters.lastValue} + 1` },
    })
    .returning({ seq: numberCounters.lastValue });
  return formatDocNumber(s.pattern, { companyCode: s.companyCode, date: docDate, seq: row.seq, fyStartMonth: s.fyStartMonth });
}

const today = () => businessDate();

export async function numberingRoutes(app: FastifyInstance) {
  app.get('/numbering', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.numbering', 'view');
    const companyId = requireCompany(ctx);
    return inTenantTx(ctx, async (tx) => {
      const out = [];
      for (const d of DOC_TYPES) {
        const s = await seriesFor(tx, companyId, d.key);
        const period = periodOf(today(), s.resetYearly, s.fyStartMonth);
        const [c] = await tx
          .select({ last: numberCounters.lastValue })
          .from(numberCounters)
          .where(and(eq(numberCounters.companyId, companyId), eq(numberCounters.docType, d.key), eq(numberCounters.period, period)));
        const next = (c?.last ?? 0) + 1;
        out.push({
          docType: d.key,
          label: d.label,
          pattern: s.pattern,
          resetYearly: s.resetYearly,
          financialYear: s.resetYearly ? financialYear(today(), s.fyStartMonth).long : null,
          nextSeq: next,
          nextNumber: formatDocNumber(s.pattern, { companyCode: s.companyCode, date: today(), seq: next, fyStartMonth: s.fyStartMonth }),
        });
      }
      return out;
    });
  });

  /**
   * Update a series. `nextSeq` lets you continue numbering from Excel mid-year
   * (e.g. last invoice was 045 → nextSeq 46). It can never move backwards past issued numbers.
   */
  app.put<{ Params: { docType: string } }>('/numbering/:docType', async (req) => {
    const ctx = requireCtx(req);
    requirePerm(ctx, 'admin.numbering', 'edit');
    const companyId = requireCompany(ctx);
    const d = docType(req.params.docType);
    const body = z
      .object({ pattern: z.string().trim().min(1).max(80), resetYearly: z.boolean(), nextSeq: z.number().int().min(1).optional() })
      .parse(req.body);
    const err = validatePattern(body.pattern, body.resetYearly);
    if (err) {
      throw badRequest(err, {
        hint: 'Use tokens like {CO}/EX/{FY}/{SEQ:3}. A yearly series needs {FY} or {FYL}; every series needs {SEQ} or {SEQ:n}.',
        fields: { pattern: err },
      });
    }

    return inTenantTx(ctx, async (tx) => {
      const before = await seriesFor(tx, companyId, d.key);
      if (body.resetYearly !== before.resetYearly) {
        // The counter key depends on resetYearly (FY start year vs 0), so switching would
        // restart at 1 and re-issue numbers that already exist.
        const [issued] = await tx
          .select({ docType: numberCounters.docType })
          .from(numberCounters)
          .where(and(eq(numberCounters.companyId, companyId), eq(numberCounters.docType, d.key), gt(numberCounters.lastValue, 0)))
          .limit(1);
        if (issued) {
          throw badRequest('Numbers have already been issued in this series, so the yearly reset setting cannot change', {
            hint: 'Keep the current setting. You can still change the pattern or raise Next no.; neither re-issues used numbers.',
            fields: { resetYearly: 'Locked once numbers are issued' },
          });
        }
      }
      await tx
        .insert(numberSeries)
        .values({ companyId, docType: d.key, pattern: body.pattern, resetYearly: body.resetYearly, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: [numberSeries.companyId, numberSeries.docType],
          set: { pattern: body.pattern, resetYearly: body.resetYearly, updatedAt: new Date(), updatedBy: ctx.userId },
        });
      if (body.nextSeq !== undefined) {
        const period = periodOf(today(), body.resetYearly, before.fyStartMonth);
        const [c] = await tx
          .select({ last: numberCounters.lastValue })
          .from(numberCounters)
          .where(and(eq(numberCounters.companyId, companyId), eq(numberCounters.docType, d.key), eq(numberCounters.period, period)))
          .for('update');
        const issued = c?.last ?? 0;
        if (body.nextSeq <= issued) {
          throw badRequest(`Numbers up to ${issued} are already issued`, {
            hint: `Set Next no. to ${issued + 1} or higher. Lower numbers would duplicate documents that already exist.`,
            fields: { nextSeq: 'Too low' },
          });
        }
        await tx
          .insert(numberCounters)
          .values({ companyId, docType: d.key, period, lastValue: body.nextSeq - 1 })
          .onConflictDoUpdate({
            target: [numberCounters.companyId, numberCounters.docType, numberCounters.period],
            set: { lastValue: body.nextSeq - 1 },
          });
      }
      await audit(tx, ctx, {
        entity: 'number_series',
        recordId: d.key,
        action: 'update',
        before: { pattern: before.pattern, resetYearly: before.resetYearly },
        after: { pattern: body.pattern, resetYearly: body.resetYearly, nextSeq: body.nextSeq },
      });
      return { ok: true };
    });
  });
}
