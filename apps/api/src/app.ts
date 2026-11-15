import { existsSync } from 'node:fs';
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
import { filesRoutes } from './modules/files.routes.js';
import { mastersRoutes } from './modules/masters/masters.routes.js';
import { numberingRoutes } from './modules/numbering.js';
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
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      return reply.status(404).send({ error: 'not_found', message: 'Not found' });
    });
  }

  return app;
}
