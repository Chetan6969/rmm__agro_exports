import type { ApiErrorBody } from '@rmm/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message || `Request failed (${status})`);
  }
  get fields() {
    return this.body.fields ?? {};
  }
  /** What the user can do about it, as sent by the server. */
  get hint() {
    return this.body.hint;
  }
}

const NETWORK_ERROR: ApiErrorBody = {
  error: 'network',
  message: 'Cannot reach the ERP server',
  hint: 'Check that the server computer is switched on and that this device is connected to the office network, then try again.',
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects when the request never reached a server (offline, server down).
    throw new ApiError(0, NETWORK_ERROR);
  }
  if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized?.();
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const body =
      data && typeof data === 'object' && 'message' in data
        ? (data as ApiErrorBody)
        : {
            error: 'http_error',
            message: `The server answered with an error (${res.status})`,
            hint:
              res.status >= 502 && res.status <= 504
                ? 'The ERP server is restarting or not running. Wait a moment and try again; if it persists, ask your administrator to check the server.'
                : 'Try again. If it keeps happening, tell your administrator what you were doing.',
          };
    throw new ApiError(res.status, body);
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body ?? {}),
  upload: <T>(url: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<T>('POST', url, fd);
  },
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** The "how to fix it" text for an error, when there is one. */
export const errorHint = (e: unknown): string | undefined =>
  e instanceof ApiError ? e.hint : e instanceof Error ? undefined : 'Reload the page and try again.';
