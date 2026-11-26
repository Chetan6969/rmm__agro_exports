/**
 * Commands that put in or wipe made-up data run on a development machine only: the database server
 * must be on this computer and NODE_ENV must not be production.
 */
import { config } from '../config.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertDevelopmentDatabase(databaseUrl: string, refusal: string, env: string = config.env) {
  if (env === 'production') throw new Error(`Refusing to ${refusal}: NODE_ENV is production. This command is for development machines only.`);
  const host = new URL(databaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to ${refusal}: the database server "${host}" is not this computer. This command only works on a local development database.`);
}
