import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema/index.js';

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Executor = DB | Tx;

let sqlClient: postgres.Sql | null = null;
let dbInstance: DB | null = null;

/** Application database (non-superuser role, RLS enforced). */
export function db(): DB {
  if (!dbInstance) {
    sqlClient = connect(config.databaseUrl(), {
      max: 20,
      idle_timeout: 30,
      // numeric/date stay strings: no float drift, no timezone shifts on DATE columns
      types: { date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: (v: string) => v } },
      onnotice: () => {},
    });
    dbInstance = drizzle(sqlClient, { schema, casing: 'snake_case' });
  }
  return dbInstance;
}

export async function closeDb() {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = null;
  dbInstance = null;
}

/**
 * postgres.js cannot parse libpq-style unix socket URLs (postgres://user@/db?host=/var/run/postgresql),
 * so translate them into its `path` option.
 */
export function connect(url: string, opts: postgres.Options<Record<string, postgres.PostgresType>> = {}) {
  const m = url.match(/^(postgres(?:ql)?:\/\/)([^@/]*@)?([^/?]*)(\/[^?]*)?(?:\?(.*))?$/);
  const params = new URLSearchParams(m?.[5] ?? '');
  const socketDir = params.get('host');
  if (m && socketDir?.startsWith('/')) {
    params.delete('host');
    const port = m[3]?.split(':')[1] ?? '5432';
    const rest = params.toString();
    const tcpUrl = `${m[1]}${m[2] ?? ''}localhost:${port}${m[4] ?? ''}${rest ? `?${rest}` : ''}`;
    return postgres(tcpUrl, { ...opts, path: `${socketDir}/.s.PGSQL.${port}` });
  }
  return postgres(url, opts);
}

/** Admin connection for setup / migrations / seed only. */
export function adminSql(url = config.databaseAdminUrl()) {
  return connect(url, { max: 1, onnotice: () => {} });
}
