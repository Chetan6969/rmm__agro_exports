import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from '../config.js';
import { adminSql } from './client.js';
import { rlsSql } from './rls.js';

// src/db/ in dev, dist/ when bundled
export const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  path.basename(import.meta.dirname) === 'dist' ? '../drizzle' : '../../drizzle',
);

export async function migrateDatabase(adminUrl = config.databaseAdminUrl(), appRole?: string) {
  const role = appRole ?? decodeURIComponent(new URL(config.databaseUrl()).username);
  const sql = adminSql(adminUrl);
  try {
    await migrate(drizzle(sql), { migrationsFolder: process.env.MIGRATIONS_DIR ?? MIGRATIONS_DIR });
    await sql.unsafe(rlsSql(role));
  } finally {
    await sql.end();
  }
}

