import path from 'node:path';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: () => req('DATABASE_URL'),
  databaseAdminUrl: () => req('DATABASE_ADMIN_URL'),
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  storageDir: path.resolve(process.env.STORAGE_DIR ?? './storage'),
  webDist: process.env.WEB_DIST ?? path.resolve(import.meta.dirname, '../../web/dist'),
  maxUploadBytes: 5 * 1024 * 1024,
};
