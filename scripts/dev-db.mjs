#!/usr/bin/env node
/**
 * Local development PostgreSQL cluster, kept in ./.dev-db (gitignored).
 *
 *   node scripts/dev-db.mjs start | stop | status
 *
 * Uses the PostgreSQL command-line tools on PATH (initdb, pg_ctl, pg_isready) and listens
 * on localhost only, on DEV_DB_PORT (default 55432) so it never clashes with an installed
 * PostgreSQL service on 5432. Production uses the server's own PostgreSQL (see README).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, '.dev-db', 'pgdata');
export const LOG_FILE = path.join(ROOT, '.dev-db', 'postgres.log');
export const PORT = Number(process.env.DEV_DB_PORT ?? 55432);

export class SetupError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

const PG_TOOLS_HINT =
  'Install PostgreSQL 16 or newer and add its bin folder to PATH ' +
  '(Windows: C:\\Program Files\\PostgreSQL\\18\\bin; Linux: install the postgresql package), then open a new terminal and run this again.';

/** Runs a PostgreSQL tool; stdio is never piped to the server process (a piped handle keeps pg_ctl from returning). */
function pg(tool, args, { quiet = false } = {}) {
  const res = spawnSync(tool, args, { stdio: quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (res.error?.code === 'ENOENT') {
    throw new SetupError(`"${tool}" was not found`, PG_TOOLS_HINT);
  }
  if (res.error) throw res.error;
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() };
}

export const isInitialized = () => existsSync(path.join(DATA_DIR, 'PG_VERSION'));

export function isRunning() {
  if (!isInitialized()) return false;
  return pg('pg_ctl', ['-D', DATA_DIR, 'status']).code === 0;
}

/** Creates the cluster with password authentication for the given superuser password. */
export function initCluster(superuserPassword) {
  if (isInitialized()) return false;
  mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  const pwFile = path.join(ROOT, '.dev-db', '.pwfile');
  writeFileSync(pwFile, superuserPassword, { mode: 0o600 });
  try {
    const res = pg('initdb', [
      '-D', DATA_DIR,
      '-U', 'postgres',
      `--pwfile=${pwFile}`,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ]);
    if (res.code !== 0) {
      throw new SetupError(`initdb failed:\n${res.out}`, `Delete the folder ${path.dirname(DATA_DIR)} and run the setup again.`);
    }
  } finally {
    rmSync(pwFile, { force: true });
  }
  return true;
}

function logTail(lines = 15) {
  if (!existsSync(LOG_FILE)) return '';
  return readFileSync(LOG_FILE, 'utf8').trim().split(/\r?\n/).slice(-lines).join('\n');
}

export function start() {
  if (!isInitialized()) {
    throw new SetupError('The development database has not been created yet', 'Run "pnpm setup:dev" once to create it.');
  }
  if (isRunning()) return 'already running';
  // A crash can leave a stale lock file behind; pg_ctl refuses to start while it exists.
  const res = pg('pg_ctl', ['-D', DATA_DIR, '-o', `-p ${PORT} -c listen_addresses=localhost`, '-l', LOG_FILE, '-w', '-t', '30', 'start'], {
    quiet: true,
  });
  if (res.code !== 0 || !isRunning()) {
    const tail = logTail();
    const portBusy = /could not bind|address already in use/i.test(tail);
    throw new SetupError(
      `PostgreSQL did not start. Last log lines (${LOG_FILE}):\n${tail}`,
      portBusy
        ? `Port ${PORT} is used by another program. Set DEV_DB_PORT to a free port (e.g. 55433) and use the same port in DATABASE_URL and DATABASE_ADMIN_URL in apps/api/.env.`
        : /lock file .*already exists/i.test(tail)
          ? `Another PostgreSQL is using this data folder, or it crashed. Run "pnpm db:stop"; if that fails, end the postgres.exe processes for ${DATA_DIR} in Task Manager and delete postmaster.pid in that folder.`
          : 'Read the log lines above. If the data folder is damaged, delete .dev-db and run "pnpm setup:dev" again (this erases local test data only).',
    );
  }
  return `started on localhost:${PORT}`;
}

export function stop() {
  if (!isRunning()) return 'not running';
  const res = pg('pg_ctl', ['-D', DATA_DIR, '-m', 'fast', '-w', 'stop']);
  if (res.code !== 0) throw new SetupError(`pg_ctl stop failed:\n${res.out}`, 'Try again in a few seconds, or end the postgres.exe processes in Task Manager.');
  return 'stopped';
}

export function report(err) {
  console.error(`\n✖ ${err.message}`);
  if (err.hint) console.error(`  How to fix: ${err.hint}`);
  process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'start') console.log(`Development database ${start()} (data: ${DATA_DIR})`);
    else if (cmd === 'stop') console.log(`Development database ${stop()}`);
    else if (cmd === 'status') {
      console.log(
        !isInitialized() ? 'Not created yet: run "pnpm setup:dev".' : isRunning() ? `Running on localhost:${PORT}` : 'Stopped: run "pnpm db:start".',
      );
    } else {
      throw new SetupError(`Unknown command "${cmd ?? ''}"`, 'Use: node scripts/dev-db.mjs start | stop | status');
    }
  } catch (err) {
    report(err);
  }
}
