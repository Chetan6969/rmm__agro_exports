import path from 'node:path';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required setting ${name}. Add it to apps/api/.env (copy apps/api/.env.example for the format), then restart.`);
  }
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
  /**
   * Trust X-Forwarded-For only behind a reverse proxy that sets it. Served directly on the LAN,
   * trusting it would let any client pick its own IP and dodge the login rate limit.
   */
  trustProxy: process.env.TRUST_PROXY === 'true',
  /** Minutes before live exchange rates are re-checked when someone views them (providers update daily). */
  exchangeRateRefreshMinutes: Math.max(5, Number(process.env.EXCHANGE_RATE_REFRESH_MINUTES ?? 60) || 60),
  /** Key that encrypts saved mailbox app passwords. Required before anyone connects a mailbox. */
  mailSecretKey: () => process.env.MAIL_SECRET_KEY ?? '',
  /** Minutes between automatic checks of connected mailboxes for replies (0 = only the "Check now" button). */
  mailPollMinutes: Math.max(0, Number(process.env.MAIL_POLL_MINUTES ?? 5) || 0),
  /** Default hours before an unanswered rate request gets an automatic reminder (0 = no reminders). */
  mailReminderHours: Math.max(0, Number(process.env.MAIL_REMINDER_HOURS ?? 48) || 0),
  /** How many reminders at most per contact and enquiry. */
  mailMaxReminders: Math.max(0, Number(process.env.MAIL_MAX_REMINDERS ?? 2) || 0),
  /** Only mail received in the last N days is read when a mailbox is first connected. */
  mailLookbackDays: Math.max(1, Number(process.env.MAIL_LOOKBACK_DAYS ?? 30) || 30),
  /** Attachments of replies above this size are listed but not saved. */
  mailMaxAttachmentBytes: Math.max(1, Number(process.env.MAIL_MAX_ATTACHMENT_MB ?? 10) || 10) * 1024 * 1024,
  storageDir: path.resolve(process.env.STORAGE_DIR ?? './storage'),
  webDist: process.env.WEB_DIST ?? path.resolve(import.meta.dirname, '../../web/dist'),
  maxUploadBytes: 5 * 1024 * 1024,
};
