import { describe, expect, it } from 'vitest';
import { assertDevelopmentDatabase } from '../src/db/dev-only.js';

describe('development-only commands (demo data, wipe)', () => {
  it('run on a local development database only', () => {
    const local = 'postgres://app@localhost:5432/erp';
    expect(() => assertDevelopmentDatabase(local, 'load demo data', 'development')).not.toThrow();
    expect(() => assertDevelopmentDatabase(local, 'load demo data', 'production')).toThrow(/NODE_ENV is production/);
    expect(() => assertDevelopmentDatabase('postgres://app@db.example.test:5432/erp', 'load demo data', 'development')).toThrow(/not this computer/);
  });
});
