import { config } from './config.js';
import { buildApp } from './app.js';
import { closeDb } from './db/client.js';
import { startMailWorker, stopMailWorker } from './modules/freight/freight.service.js';
import { resumeQueued } from './modules/intake/intake.service.js';
import { stopOcr } from './modules/intake/read.js';
import { syncSystemRoles } from './modules/roles.routes.js';

const app = await buildApp();
await syncSystemRoles();
await app.listen({ host: config.host, port: config.port });
console.log(`RMM Export ERP API on http://${config.host}:${config.port}`);
// reads replies to freight enquiries and sends due reminders (MAIL_POLL_MINUTES)
startMailWorker(app.log);
// finish reading inbox documents that were waiting when the server stopped
void resumeQueued().catch((e) => app.log.warn(e, 'inbox resume failed'));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    stopMailWorker();
    await stopOcr();
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
