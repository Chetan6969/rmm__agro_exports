#!/usr/bin/env node
/**
 * One-time local development setup. Safe to re-run: existing settings and data are kept.
 *
 *   pnpm setup:dev
 *
 * 1. writes apps/api/.env with generated local-only passwords (if it does not exist)
 * 2. creates and starts the development PostgreSQL cluster in ./.dev-db
 * 3. creates the database + app role, runs migrations and Row Level Security (db:setup)
 * 4. creates the first super admin and baseline masters (db:seed)
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { initCluster, PORT, report, ROOT, SetupError, start } from './dev-db.mjs';

const ENV_FILE = path.join(ROOT, 'apps', 'api', '.env');
const secret = (bytes) => randomBytes(bytes).toString('base64url');

function writeEnv() {
  const appPassword = secret(18);
  const superPassword = secret(18);
  writeFileSync(
    ENV_FILE,
    `# Local development settings, created by "pnpm setup:dev". Never commit this file.
NODE_ENV=development
HOST=127.0.0.1
PORT=4000

# Application connection (non-superuser role, so Row Level Security applies)
DATABASE_URL=postgres://rmm_app:${appPassword}@localhost:${PORT}/rmm_export_erp
# Superuser connection, used only by db:setup / db:migrate / db:seed
DATABASE_ADMIN_URL=postgres://postgres:${superPassword}@localhost:${PORT}/rmm_export_erp
APP_DB_PASSWORD=${appPassword}

# First super admin. Leave the password empty: db:seed prints a random temporary password
# once and asks for a new one at first sign-in.
ADMIN_USERNAME=admin
ADMIN_PASSWORD=

SESSION_HOURS=12
COOKIE_SECURE=false
TRUST_PROXY=false
STORAGE_DIR=./storage
`,
    { mode: 0o600 },
  );
}

function superuserPassword() {
  const url = readFileSync(ENV_FILE, 'utf8').match(/^DATABASE_ADMIN_URL=(.*)$/m)?.[1]?.trim();
  if (!url) throw new SetupError('DATABASE_ADMIN_URL is missing from apps/api/.env', 'Add it (see apps/api/.env.example) or delete apps/api/.env and run "pnpm setup:dev" again.');
  return decodeURIComponent(new URL(url).password);
}

/** Runs a fixed pnpm script (no user input reaches the command line). */
function pnpm(args) {
  // pnpm is a .cmd shim on Windows, which needs a shell; pass one command string so nothing is concatenated implicitly.
  const res = spawnSync(`pnpm ${args.join(' ')}`, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    throw new SetupError(`"pnpm ${args.join(' ')}" failed`, 'Read the error above; the database is running, so you can fix the cause and run "pnpm setup:dev" again.');
  }
}

try {
  if (!existsSync(path.join(ROOT, 'node_modules'))) {
    throw new SetupError('Dependencies are not installed', 'Run "pnpm install" first.');
  }
  if (existsSync(ENV_FILE)) {
    console.log('• apps/api/.env exists: keeping your settings');
  } else {
    writeEnv();
    console.log('• Created apps/api/.env with generated local-only passwords');
  }
  console.log(initCluster(superuserPassword()) ? '• Created the development database cluster in .dev-db' : '• Development database cluster already exists');
  console.log(`• Database ${start()}`);
  pnpm(['db:setup']);
  pnpm(['db:seed']);
  console.log(`
✔ Ready. Next:
    pnpm dev            start the API (port 4000) and the web app (port 5173)
    open http://localhost:5173 and sign in as "admin"
  If db:seed printed a temporary password above, use it once; you will be asked to choose a new one.
  After a reboot, start the database again with "pnpm db:start" (or use "pnpm start:dev" for both).`);
} catch (err) {
  report(err);
}
