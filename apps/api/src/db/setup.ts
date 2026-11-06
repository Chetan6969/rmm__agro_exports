/**
 * One-time database setup (safe to re-run):
 *   - creates the database named in DATABASE_ADMIN_URL if missing
 *   - creates / updates the non-superuser application role from DATABASE_URL
 *   - runs migrations + RLS
 *
 * Usage: pnpm db:setup
 */
import { config } from '../config.js';
import { connect } from './client.js';
import { migrateDatabase } from './migrate.js';

export async function setupDatabase(adminUrl = config.databaseAdminUrl(), appUrl = config.databaseUrl()) {
  const dbName = decodeURIComponent(adminUrl.match(/^postgres(?:ql)?:\/\/[^/]*\/([^?]+)/)?.[1] ?? '');
  const app = new URL(appUrl);
  const appRole = decodeURIComponent(app.username);
  const appPassword = process.env.APP_DB_PASSWORD || decodeURIComponent(app.password);
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName) || !/^[a-z_][a-z0-9_]*$/.test(appRole)) {
    throw new Error('Database and role names must be lowercase identifiers');
  }

  // connect to the maintenance DB to create the target DB
  const maint = connect(adminUrl.replace(`/${dbName}`, '/postgres'), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await maint`select 1 from pg_database where datname = ${dbName}`;
    if (!exists) {
      await maint.unsafe(`create database ${dbName}`);
      console.log(`created database ${dbName}`);
    }
    const [role] = await maint`select 1 from pg_roles where rolname = ${appRole}`;
    const pw = appPassword.replace(/'/g, "''");
    if (!role) {
      await maint.unsafe(`create role ${appRole} login password '${pw}' nosuperuser nocreatedb nocreaterole nobypassrls`);
      console.log(`created role ${appRole}`);
    } else {
      await maint.unsafe(`alter role ${appRole} login password '${pw}' nosuperuser nobypassrls`);
    }
    await maint.unsafe(`grant connect on database ${dbName} to ${appRole}`);
  } finally {
    await maint.end();
  }
  await migrateDatabase(adminUrl, appRole);
}

