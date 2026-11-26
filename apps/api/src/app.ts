import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { config } from './config.js';
import { db } from './db/client.js';
import { errorHandler, unauthorized } from './core/errors.js';
import { loadSession } from './core/session.js';
import { auditRoutes } from './modules/audit.routes.js';
import { authRoutes } from './modules/auth.routes.js';
import { documentRoutes } from './modules/documents/documents.routes.js';
import { exchangeRateRoutes } from './modules/exchange-rates.js';
import { filesRoutes } from './modules/files.routes.js';
import { freightRoutes } from './modules/freight/freight.routes.js';
import { intakeRoutes } from './modules/intake/intake.routes.js';
import { planningRoutes } from './modules/planning/planning.routes.js';
import { mastersRoutes } from './modules/masters/masters.routes.js';
import { misRoutes } from './modules/mis/index.js';
import { numberingRoutes } from './modules/numbering.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import { recycleBinRoutes } from './modules/recycle-bin.js';
import { pipelineRoutes } from './modules/shipments/pipeline.js';
import { shipmentsRoutes } from './modules/shipments/shipments.routes.js';
import { rolesRoutes } from './modules/roles.routes.js';
import { sharingRoutes } from './modules/sharing.routes.js';
import { usersRoutes } from './modules/users.routes.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    logger: opts.logger ?? { level: config.env === 'production' ? 'info' : 'warn' },
    ...opts,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        // LAN deployments usually run on plain http; do not force https sub-resources
        upgradeInsecureRequests: null,
      },
    },
    hsts: config.cookieSecure,
  });
  await app.register(cookie);
  await app.register(multipart);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('ctx', null);
  app.setErrorHandler(errorHandler);

  await app.register(
    async (api) => {
      api.addHook('onRequest', async (req, reply) => {
        await loadSession(req, reply);
        if (!req.routeOptions.config.public && !req.ctx) throw unauthorized();
      });

      api.get('/health', { config: { public: true } }, async () => {
        await db().execute(sql`select 1`);
        return { ok: true, time: new Date().toISOString() };
      });

      await api.register(authRoutes);
      await api.register(mastersRoutes);
      await api.register(usersRoutes);
      await api.register(rolesRoutes);
      await api.register(sharingRoutes);
      await api.register(numberingRoutes);
      await api.register(filesRoutes);
      await api.register(auditRoutes);
      await api.register(exchangeRateRoutes);
      await api.register(documentRoutes);
      await api.register(paymentsRoutes);
      await api.register(shipmentsRoutes);
      await api.register(pipelineRoutes);
      await api.register(freightRoutes);
      await api.register(intakeRoutes);
      await api.register(planningRoutes);
      await api.register(recycleBinRoutes);
      await api.register(misRoutes);

      api.setNotFoundHandler((_req, reply) =>
        reply.status(404).send({
          error: 'not_found',
          message: 'No such API route',
          hint: 'Reload the page; if the app was just updated, a hard refresh (Ctrl+F5) loads the new version.',
        }),
      );
    },
    { prefix: '/api' },
  );

  // Production: serve the built web app from the same port (one process on the LAN server).
  if (existsSync(config.webDist)) {
    // The content-hashed files under /assets never change for a given name, so they
    // can be cached hard. index.html is NOT served from here (index: false) — it is
    // sent below with no-cache so a freshly built app is always picked up at once.
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false, index: false, maxAge: '365d', immutable: true });

    // Read the shell once; a new build restarts the server, which re-reads it.
    const indexHtml = readFileSync(join(config.webDist, 'index.html'), 'utf8');

    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      // A real 404 for API routes, non-GET requests, and — crucially — any missing
      // FILE (a path that has an extension). Returning the HTML shell for a .css/.js
      // URL hands the browser text/html, which it refuses to apply as a stylesheet or
      // module, breaking styling and scripts across the whole app. Only extension-less
      // navigation routes (e.g. /d/commercialInvoices/new) get the shell.
      if (req.method !== 'GET' || url.startsWith('/api/') || /\.[a-z0-9]+$/i.test(url)) {
        return reply.status(404).send({ error: 'not_found', message: 'Not found' });
      }
      return reply.header('cache-control', 'no-cache').type('text/html').send(indexHtml);
    });
  }

  return app;
}
