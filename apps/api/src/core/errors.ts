import type { ApiErrorBody } from '@rmm/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Every error the API returns says what went wrong (`message`) and what the user can do
 * about it (`hint`). Field errors (`fields`) point at the inputs to fix.
 */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public hint?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Either just a hint, or a hint plus field-level messages. */
export type ErrorDetail = string | { hint?: string; fields?: Record<string, string> };

const detail = (d: ErrorDetail | undefined, fallbackHint?: string) =>
  typeof d === 'string' ? { hint: d } : { hint: d?.hint ?? fallbackHint, fields: d?.fields };

const make =
  (status: number, code: string, fallbackMessage: string, fallbackHint?: string) =>
  (message = fallbackMessage, d?: ErrorDetail) => {
    const { hint, fields } = detail(d, fallbackHint);
    return new AppError(status, code, message, hint, fields);
  };

export const HINTS = {
  signIn: 'Your session may have expired or you signed out on another tab. Sign in again.',
  permission: 'Ask an administrator to add this permission to your role (Administration → Roles & permissions).',
  notFound: 'It may have been deleted, or it belongs to another company. Reload the list, or switch company with Alt+C.',
  reload: 'Reload the page to get the latest version, re-apply your change and save again.',
  selectCompany: 'Choose the company you want to work in with Alt+C (or the company button at the top), then try again.',
  fixFields: 'Correct the highlighted fields and save again.',
} as const;

export const badRequest = make(400, 'bad_request', 'The request could not be processed', HINTS.fixFields);
export const unauthorized = make(401, 'unauthorized', 'Please sign in', HINTS.signIn);
export const forbidden = make(403, 'forbidden', 'You do not have permission for this action', HINTS.permission);
export const notFound = make(404, 'not_found', 'Record not found', HINTS.notFound);
export const conflict = make(409, 'conflict', 'This record was changed by someone else', HINTS.reload);

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
  column_name?: string;
}

function pgCause(err: unknown): PgError | null {
  let e = err as { cause?: unknown } & PgError;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    e = e.cause as typeof e;
  }
  return null;
}

/** Connection-level failures from postgres.js / Node sockets. */
function isDbUnreachable(err: unknown): boolean {
  let e = err as { code?: unknown; cause?: unknown } | undefined;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e.code === 'string' && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED'].includes(e.code)) {
      return true;
    }
    e = e.cause as typeof e;
  }
  return false;
}

/** "customers_company_code_uq" → "code" */
const columnFromConstraint = (name?: string) => name?.replace(/_(uq|fk|check|idx)$/, '').split('_').slice(-1)[0];

function send(reply: FastifyReply, status: number, body: ApiErrorBody) {
  return reply.status(status).send(body);
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return send(reply, err.status, { error: err.code, message: err.message, hint: err.hint, fields: err.fields });
  }
  if (err instanceof ZodError) {
    const fields = zodFields(err);
    return send(reply, 400, {
      error: 'validation',
      message: Object.values(fields)[0] ?? 'Some values are not valid',
      hint: HINTS.fixFields,
      fields,
    });
  }

  const pg = pgCause(err);
  switch (pg?.code) {
    case '23505': {
      const col = columnFromConstraint(pg.constraint_name);
      return send(reply, 409, {
        error: 'duplicate',
        message: `A record with this ${col ?? 'value'} already exists`,
        hint: `Use a different ${col ?? 'value'}, or search the list for the existing record and edit that one instead.`,
        fields: col ? { [col]: 'Already exists' } : undefined,
      });
    }
    case '23503':
      return send(reply, 409, {
        error: 'in_use',
        message: 'This record is linked to other records and cannot be changed this way',
        hint: 'Change or remove the records that use it first, or mark this record inactive instead of deleting it.',
      });
    case '42501':
      return send(reply, 403, {
        error: 'forbidden',
        message: 'This record belongs to another company',
        hint: 'Switch to the owning company (Alt+C), or ask that company to share it with yours (Administration → Data sharing).',
      });
    case '22001':
      return send(reply, 400, { error: 'too_long', message: 'A value is longer than this field allows', hint: 'Shorten the text and save again.' });
    case '22003':
      return send(reply, 400, {
        error: 'out_of_range',
        message: 'A number is too large for this field',
        hint: 'Check for extra digits or too many decimal places, then save again.',
      });
    case '22P02':
    case '22007':
    case '22008':
      return send(reply, 400, {
        error: 'invalid_format',
        message: 'A value has the wrong format',
        hint: 'Numbers must contain digits only (use . for decimals) and dates must be valid calendar dates.',
      });
    case '23502': {
      const col = pg.column_name;
      return send(reply, 400, {
        error: 'required',
        message: `${col ? `"${col}"` : 'A required value'} is missing`,
        hint: HINTS.fixFields,
        fields: col ? { [col]: 'Required' } : undefined,
      });
    }
    case '23514':
      return send(reply, 400, { error: 'invalid_value', message: 'A value breaks a data rule', hint: HINTS.fixFields });
  }

  if (isDbUnreachable(err)) {
    req.log.error(err, 'database unreachable');
    return send(reply, 503, {
      error: 'database_unavailable',
      message: 'The database is not reachable',
      hint: 'Check that PostgreSQL is running on the server and that DATABASE_URL in apps/api/.env is correct, then try again.',
    });
  }

  const fe = err as FastifyError;
  if (fe.statusCode === 429) {
    return send(reply, 429, {
      error: 'too_many_requests',
      message: 'Too many attempts',
      hint: 'Wait a minute and try again. If you have forgotten your password, ask an administrator to reset it.',
    });
  }
  if (fe.statusCode === 413 || fe.code === 'FST_REQ_FILE_TOO_LARGE') {
    return send(reply, 413, {
      error: 'too_large',
      message: 'The upload or request is too large',
      hint: 'Use a smaller file (images can be compressed or resized) and try again.',
    });
  }
  if (fe.statusCode && fe.statusCode < 500) {
    return send(reply, fe.statusCode, { error: fe.code ?? 'error', message: fe.message, hint: 'Check the values you entered and try again.' });
  }

  req.log.error(err);
  return send(reply, 500, {
    error: 'internal',
    message: 'Unexpected server error',
    hint: `Try again. If it keeps happening, tell your administrator and quote reference ${req.id}: the server log has the details under that id.`,
  });
}
