import { config } from './config.js';
import { buildApp } from './app.js';
import { closeDb } from './db/client.js';
import { syncSystemRoles } from './modules/roles.routes.js';

const app = await buildApp();
await syncSystemRoles();
await app.listen({ host: config.host, port: config.port });
console.log(`RMM Export ERP API on http://${config.host}:${config.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
