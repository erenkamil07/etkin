import { defineConfig, mergeConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';

// Integration tests run against a real PostgreSQL server: PGlite executes one
// query at a time, so race conditions can only be reproduced here.
export default mergeConfig(
  { resolve: unitConfig.resolve },
  defineConfig({
    test: {
      include: ['test/integration/**/*.test.ts'],
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  }),
);
