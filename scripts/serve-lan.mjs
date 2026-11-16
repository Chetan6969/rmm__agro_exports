#!/usr/bin/env node
/**
 * Runs the ERP for the office network (intranet / Ethernet / Wi-Fi):
 *
 *   pnpm serve:lan            build, apply migrations, start on port 4000 for every computer on the LAN
 *   pnpm serve:lan --no-build skip the build (when nothing changed since the last run)
 *
 * One production server serves both the website and the API, so other computers only need
 * http://<this computer's IP>:4000. The database stays on localhost and is never exposed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, report, ROOT, SetupError, start as startDb } from './dev-db.mjs';

const ENV_FILE = path.join(ROOT, 'apps', 'api', '.env');
const envValue = (name) => readFileSync(ENV_FILE, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();

function pnpm(args, what) {
  const res = spawnSync(`pnpm ${args.join(' ')}`, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new SetupError(`${what} failed`, 'Read the error above, fix it and run "pnpm serve:lan" again.');
}

/** IPv4 addresses other computers can use, wired (Ethernet) adapters first. */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|Loopback|Tailscale|ZeroTier/i.test(name)) continue;
      out.push({ name, address: a.address, wired: /ethernet|eth|lan|en\d/i.test(name) && !/wi-?fi|wlan|wireless/i.test(name) });
    }
  }
  return out.sort((x, y) => Number(y.wired) - Number(x.wired));
}

const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });

try {
  if (!existsSync(ENV_FILE)) throw new SetupError('apps/api/.env is missing', 'Run "pnpm setup:dev" once on this computer first.');
  const port = Number(process.env.PORT ?? envValue('PORT') ?? 4000);
  if (!(await portFree(port))) {
    throw new SetupError(
      `Port ${port} is already in use`,
      `Stop "pnpm dev" / "pnpm start:dev" (Ctrl+C in its window) or any other program on port ${port}, then run this again. To use another port, set PORT in apps/api/.env.`,
    );
  }
  if (existsSync(DATA_DIR)) console.log(`• Database ${startDb()}`);
  if (!process.argv.includes('--no-build')) {
    console.log('• Building the website and server…');
    pnpm(['build'], 'The build');
  } else if (!existsSync(path.join(ROOT, 'apps', 'web', 'dist', 'index.html'))) {
    throw new SetupError('The website has not been built yet', 'Run "pnpm serve:lan" without --no-build once.');
  }
  console.log('• Applying database migrations…');
  pnpm(['db:migrate'], 'Database migration');

  const addrs = lanAddresses();
  const server = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/main.js'], {
    cwd: path.join(ROOT, 'apps', 'api'),
    // HOST/NODE_ENV from here win over apps/api/.env (Node never overrides variables that are already set)
    env: { ...process.env, HOST: '0.0.0.0', NODE_ENV: 'production', PORT: String(port) },
    stdio: 'inherit',
  });
  server.once('spawn', () => {
    console.log(`\n✔ RMM Export ERP is running for the office network on port ${port}.`);
    console.log(`  On this computer:   http://localhost:${port}`);
    if (addrs.length) {
      for (const a of addrs) console.log(`  Other computers:    http://${a.address}:${port}   (${a.name}${a.wired ? ', wired' : ''})`);
    } else {
      console.log('  No network adapter with an IPv4 address was found: connect the Ethernet cable / Wi-Fi and run this again.');
    }
    console.log(
      `\n  If other computers cannot open it: allow port ${port} in Windows Firewall (Private network) and make sure this network is set to "Private", not "Public".` +
        '\n  Keep this window open; press Ctrl+C to stop the server.\n',
    );
  });
  server.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
} catch (err) {
  report(err);
}
