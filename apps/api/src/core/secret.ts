/**
 * Encryption for secrets the ERP must be able to read back (mailbox app passwords).
 * AES-256-GCM with a key from MAIL_SECRET_KEY; the stored text is "v1.<iv>.<tag>.<data>" (base64url).
 * Losing or changing the key only means users enter their app password again.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { AppError } from './errors.js';

function key(): Buffer {
  const raw = config.mailSecretKey();
  if (!raw) {
    throw new AppError(
      503,
      'mail_not_configured',
      'Email is not set up on this server yet',
      'An administrator must add MAIL_SECRET_KEY to apps/api/.env (any long random text, e.g. from "node -e \\"console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))\\"") and restart the server. See README → Email.',
    );
  }
  // Any length of key text is accepted; it is stretched to exactly 32 bytes.
  return createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unknown secret format');
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    throw new AppError(
      409,
      'mail_password_unreadable',
      'The saved mailbox password can no longer be read',
      'The server key (MAIL_SECRET_KEY) was changed. Open My mailbox and enter your app password again.',
    );
  }
}
