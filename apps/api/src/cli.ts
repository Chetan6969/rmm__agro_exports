/**
 * Database admin commands:
 *   setup    create database + app role, migrate, apply RLS (idempotent)
 *   migrate  apply pending migrations + RLS
 *   seed     create first super admin, system roles and baseline masters (idempotent)
 *   reset-password <username>   set a new random temporary password (printed once)
 *
 * Dev:  pnpm db:setup | db:migrate | db:seed
 * Prod: node --env-file=.env dist/cli.js <command>
 */
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { adminSql, closeDb } from './db/client.js';
import { sessions, users } from './db/schema/index.js';
import { migrateDatabase } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { setupDatabase } from './db/setup.js';

const cmd = process.argv[2];
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
