import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://ceh@localhost:54329/ceh_test', APP_URL: 'http://test.local' },
  },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
