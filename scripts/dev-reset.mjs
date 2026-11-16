#!/usr/bin/env node
/**
 * Full reset of the LOCAL development database: everything is erased and set up again.
 *
 *   pnpm db:reset -- --yes          empty database + super admin + baseline masters
 *   pnpm db:reset -- --yes --demo   same, then load the demo company
 *
 * Only for development machines: refused when the database is not on this computer or
 * NODE_ENV=production. To remove only the demo company, use "pnpm demo:reset" instead.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { report, ROOT, SetupError, start as startDb, isInitialized } from './dev-db.mjs';

const args = process.argv.slice(2);

function pnpm(cmd, what) {
  const res = spawnSync(`pnpm ${cmd}`, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new SetupError(`${what} failed`, 'Read the error above. The database may be empty now: fix the cause and run "pnpm db:reset -- --yes" again.');
}

try {
  if (!args.includes('--yes')) {
    console.log(`This ERASES every company, user, master, document and uploaded file in the local database.
Real office data must never be on this machine's development database.

  pnpm db:reset -- --yes          erase and start fresh
  pnpm db:reset -- --yes --demo   erase, start fresh and load the demo company
  pnpm demo:reset                 remove only the demo company instead`);
    process.exit(1);
  }
  if (isInitialized()) console.log(`• Database ${startDb()}`);
  pnpm('--filter @rmm/api exec tsx --env-file-if-exists=.env src/cli.ts wipe', 'Dropping the database');
  const storage = path.join(ROOT, 'apps', 'api', 'storage');
  if (existsSync(storage)) {
    rmSync(storage, { recursive: true, force: true });
    console.log('• Removed uploaded files (apps/api/storage)');
  }
  pnpm('db:setup', 'Database setup');
  pnpm('db:seed', 'Seeding');
  if (args.includes('--demo')) pnpm('demo:load', 'Loading demo data');
  console.log('\n✔ Fresh database ready. Sign in as the super admin from apps/api/.env (ADMIN_USERNAME / ADMIN_PASSWORD).');
} catch (err) {
  report(err);
}
