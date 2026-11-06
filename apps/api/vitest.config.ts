import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

if (existsSync('.env')) process.loadEnvFile('.env');

// Tests run against a separate database: <name>_test
const toTest = (u?: string) => u?.replace(/\/([a-z0-9_]+)(\?|$)/, '/$1_test$2');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? toTest(process.env.DATABASE_URL);
process.env.DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? toTest(process.env.DATABASE_ADMIN_URL);
process.env.STORAGE_DIR = './storage-test';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
