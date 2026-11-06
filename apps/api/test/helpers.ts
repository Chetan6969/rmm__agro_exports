import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/postgres-js';
import { buildApp } from '../src/app.js';
import { adminSql } from '../src/db/client.js';
import { users } from '../src/db/schema/index.js';
import { syncSystemRoles } from '../src/modules/roles.routes.js';

export const PASSWORD = 'Test-pass-123';

export async function makeApp() {
  const app = await buildApp({ logger: false });
  await syncSystemRoles();
  await app.ready();
  return app;
}

export async function createSuperAdmin(username: string) {
  const sql = adminSql();
  try {
    await drizzle(sql)
      .insert(users)
      .values({ username, fullName: username, passwordHash: await argon2.hash(PASSWORD), isSuperAdmin: true })
      .onConflictDoNothing();
  } finally {
    await sql.end();
  }
}

/** A signed-in HTTP client bound to one session cookie. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async login(username: string, password = PASSWORD) {
    const res = await this.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    if (res.statusCode !== 200) throw new Error(`login ${username} failed: ${res.body}`);
    const set = res.headers['set-cookie'];
    this.cookie = (Array.isArray(set) ? set[0] : set)!.split(';')[0];
    return res.json();
  }

  async req(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
    const res = await this.app.inject({
      method,
      url: `/api${url}`,
      headers: { cookie: this.cookie },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    let body: any = res.body;
    try {
      body = res.json();
    } catch {
      /* not json */
    }
    return { status: res.statusCode, body };
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  put = (url: string, body?: unknown) => this.req('PUT', url, body ?? {});
  del = (url: string, body?: unknown) => this.req('DELETE', url, body ?? {});

  async ok(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
    const r = await this.req(method, url, payload ?? (method === 'GET' ? undefined : {}));
    if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  }
}
