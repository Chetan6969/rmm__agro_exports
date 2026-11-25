import { config } from './config.js';
import { buildApp } from './app.js';
import { closeDb } from './db/client.js';
import { startMailWorker, stopMailWorker } from './modules/freight/freight.service.js';
import { syncSystemRoles } from './modules/roles.routes.js';

const app = await buildApp();
await syncSystemRoles();
await app.listen({ host: config.host, port: config.port });
console.log(`RMM Export ERP API on http://${config.host}:${config.port}`);
// reads replies to freight enquiries and sends due reminders (MAIL_POLL_MINUTES)
startMailWorker(app.log);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    stopMailWorker();
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
