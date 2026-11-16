/**
 * Drops the whole application database, for a fresh start on a development machine.
 * Refused unless the database server is on this computer and NODE_ENV is not production,
 * so it can never empty the office server by accident. Use via "pnpm db:reset -- --yes".
 */
import { config } from '../config.js';
import { connect } from './client.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export async function wipeLocalDatabase(adminUrl = config.databaseAdminUrl()) {
  const url = new URL(adminUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (config.env === 'production') throw new Error('Refusing to wipe: NODE_ENV is production. This command is for development machines only.');
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to wipe: the database server "${url.hostname}" is not this computer. This command only empties a local development database.`);
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error('The database name in DATABASE_ADMIN_URL must be a lowercase identifier.');

  const maint = connect(adminUrl.replace(`/${dbName}`, '/postgres'), { max: 1, onnotice: () => {} });
  try {
    // close connections of the running API so the drop does not wait for them
    await maint`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${dbName} and pid <> pg_backend_pid()`;
    await maint.unsafe(`drop database if exists ${dbName}`);
    console.log(`dropped database ${dbName}`);
  } finally {
    await maint.end();
  }
}
