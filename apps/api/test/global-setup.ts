import { adminSql } from '../src/db/client.js';
import { setupDatabase } from '../src/db/setup.js';

/** Fresh test database: create/migrate, then wipe every table. */
export default async function setup() {
  const adminUrl = process.env.DATABASE_ADMIN_URL!;
  if (!/_test$/.test(adminUrl.split('?')[0])) {
    throw new Error(`Refusing to run tests against a non-test database: ${adminUrl}`);
  }
  await setupDatabase(adminUrl, process.env.DATABASE_URL!);
  const sql = adminSql(adminUrl);
  const tables = await sql<{ t: string }[]>`select tablename as t from pg_tables where schemaname = 'public'`;
  await sql.unsafe(`truncate ${tables.map((r) => `"${r.t}"`).join(', ')} restart identity cascade`);
  await sql.end();
}
