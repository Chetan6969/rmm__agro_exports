import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from '../config.js';
import { adminSql } from './client.js';
import { rlsSql } from './rls.js';

// src/db/ in dev, dist/ when bundled
export const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  path.basename(import.meta.dirname) === 'dist' ? '../drizzle' : '../../drizzle',
);

/**
 * Two branches can each add migrations before they are merged. Drizzle only runs migrations newer than
 * the last one a database has, so a database built from one branch would silently skip the older ones
 * of the other. Run those here, in journal order, and record them; drizzle then does the newer ones.
 */
async function applyMissedMigrations(sql: ReturnType<typeof adminSql>, folder: string) {
  const [table] = await sql`select to_regclass('drizzle.__drizzle_migrations') as name`;
  if (!table?.name) return; // a new database: drizzle runs everything
  const done = new Set((await sql`select created_at from drizzle.__drizzle_migrations`).map((r) => Number(r.created_at)));
  if (!done.size) return;
  const last = Math.max(...done);
  for (const m of readMigrationFiles({ migrationsFolder: folder })) {
    if (m.folderMillis >= last || done.has(m.folderMillis)) continue;
    await sql.begin(async (tx) => {
      for (const statement of m.sql) await tx.unsafe(statement);
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${m.hash}, ${m.folderMillis})`;
    });
  }
}

export async function migrateDatabase(adminUrl = config.databaseAdminUrl(), appRole?: string) {
  const role = appRole ?? decodeURIComponent(new URL(config.databaseUrl()).username);
  const sql = adminSql(adminUrl);
  try {
    const migrationsFolder = process.env.MIGRATIONS_DIR ?? MIGRATIONS_DIR;
    await applyMissedMigrations(sql, migrationsFolder);
    await migrate(drizzle(sql), { migrationsFolder });
    await sql.unsafe(rlsSql(role));
  } finally {
    await sql.end();
  }
}

