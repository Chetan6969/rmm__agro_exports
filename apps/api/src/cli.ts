/**
 * Database admin commands:
 *   setup    create database + app role, migrate, apply RLS (idempotent)
 *   migrate  apply pending migrations + RLS
 *   seed     create first super admin, system roles and baseline masters (idempotent)
 *   reset-password <username>   set a new random temporary password (printed once)
 *   demo / demo-reset            load / remove the demo company (DEMO) and its data
 *   intake-import <folder> --company CODE [--limit N]   read old document folders (a local copy) into the inbox
 *   intake-accuracy <folder> [--limit N] [--out file]    measure document reading on a folder (no database writes)
 *   wipe     drop the whole LOCAL database (refused for non-local servers and NODE_ENV=production)
 *
 * Dev:  pnpm db:setup | db:migrate | db:seed
 * Prod: node --env-file=.env dist/cli.js <command>
 */
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { adminSql, closeDb } from './db/client.js';
import { importCopy, resetCopy } from './db/copy-import.js';
import { loadDemo, resetDemo } from './db/demo.js';
import { wipeLocalDatabase } from './db/wipe.js';
import { accuracyReport, bulkImport } from './modules/intake/bulk.js';
import { sessions, users } from './db/schema/index.js';
import { migrateDatabase } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { setupDatabase } from './db/setup.js';

const cmd = process.argv[2];
/** Command arguments; pnpm forwards the "--" separator, which is not an argument. */
const args = process.argv.slice(3).filter((a) => a !== '--');
const commands: Record<string, () => Promise<void>> = {
  setup: async () => {
    await setupDatabase();
    console.log('database ready');
  },
  migrate: async () => {
    await migrateDatabase();
    console.log('migrations + RLS applied');
  },
  seed: async () => {
    await seedDatabase();
  },
  demo: async () => {
    await loadDemo();
    console.log('Demo data loaded into company DEMO (Demo Agro Exports). Switch to it in the app with Alt+C. Remove it with "pnpm demo:reset".');
  },
  'demo-reset': async () => {
    console.log((await resetDemo()) ? 'Demo company DEMO and all its data were deleted. Real companies were not touched.' : 'No demo data found (company DEMO does not exist).');
  },
  'copy-load': async () => {
    const file = args[0];
    if (!file) throw new Error('usage: pnpm copy:load -- <export.json> [CODE]');
    const r = await importCopy(file, args[1]?.toUpperCase());
    console.log(`Loaded production copy as company ${r.code}:`, r.counts, `shipments: ${r.shipments}`);
    if (r.missingGlobals.length) console.log('Not in this database (kept as text on the documents):', r.missingGlobals.join(', '));
    if (r.skipped.length) console.log('Fields this version does not have (skipped):', r.skipped.join(', '));
    console.log('Switch to it in the app with Alt+C. Remove it with "pnpm copy:reset".');
  },
  'copy-reset': async () => {
    const code = (args[0] ?? 'RMMDEMO').toUpperCase();
    console.log((await resetCopy(code)) ? `Copy company ${code} and all its data were deleted.` : `No company ${code} found.`);
  },
  /** Drops the whole local database (dev only); "pnpm db:reset" recreates it afterwards. */
  // read old document folders (a LOCAL COPY) into the inbox, or measure reading accuracy on them
  'intake-import': async () => {
    await bulkImport(args);
  },
  'intake-accuracy': async () => {
    await accuracyReport(args);
  },
  wipe: async () => {
    await wipeLocalDatabase();
  },
  'reset-password': async () => {
    const username = process.argv[3]?.toLowerCase();
    if (!username) throw new Error('usage: cli reset-password <username>');
    const conn = adminSql();
    try {
      const d = drizzle(conn);
      const password = `${randomBytes(6).toString('base64url')}9a`;
      const done = await d
        .update(users)
        .set({ passwordHash: await argon2.hash(password), mustChangePassword: true, isActive: true })
        .where(and(sql`lower(${users.username}) = ${username}`, isNull(users.deletedAt)))
        .returning({ id: users.id });
      if (!done.length) throw new Error(`User ${username} not found. Check the spelling; usernames are listed under Administration → Users.`);
      await d.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, done[0].id), isNull(sessions.revokedAt)));
      console.log(`temporary password for ${username}: ${password}  (must be changed at next login)`);
    } finally {
      await conn.end();
    }
  },
};

if (!cmd || !commands[cmd]) {
  console.error(`usage: cli <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
try {
  await commands[cmd]();
  await closeDb();
} catch (e) {
  console.error(e);
  process.exit(1);
}
