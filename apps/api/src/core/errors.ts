import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new AppError(400, 'bad_request', msg, fields);
export const unauthorized = (msg = 'Please sign in') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission for this action') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Record not found') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);

export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (issue.code === 'unrecognized_keys') {
      for (const k of issue.keys) fields[k] = 'Unknown field';
    } else fields[key] ??= issue.message;
  }
  return fields;
}

interface PgError {
  code?: string;
  constraint_name?: string;
  detail?: string;
}

function pgCause(err: unknown): PgError | null {
  let e = err as { cause?: unknown } & PgError;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    e = e.cause as typeof e;
  }
  return null;
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: err.code, message: err.message, fields: err.fields });
  }
  if (err instanceof ZodError) {
    const fields = zodFields(err);
    return reply.status(400).send({ error: 'validation', message: Object.values(fields)[0] ?? 'Invalid input', fields });
  }
  const pg = pgCause(err);
  if (pg?.code === '23505') {
    const col = pg.constraint_name?.replace(/_uq$/, '').split('_').slice(-1)[0];
    return reply.status(409).send({
      error: 'duplicate',
      message: `A record with this ${col ?? 'value'} already exists`,
      fields: col ? { [col]: 'Already exists' } : undefined,
    });
  }
  if (pg?.code === '23503') {
    return reply.status(409).send({ error: 'in_use', message: 'This record is linked to other records and cannot be changed this way' });
  }
  if (pg?.code === '42501') {
    return reply.status(403).send({ error: 'forbidden', message: 'This record belongs to another company' });
  }
  const fe = err as FastifyError;
  if (fe.statusCode && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ error: fe.code ?? 'error', message: fe.message });
  }
  req.log.error(err);
  return reply.status(500).send({ error: 'internal', message: 'Unexpected server error. It has been logged.' });
}
