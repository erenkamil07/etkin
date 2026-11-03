import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests: PGlite, no services. Integration tests have their own config.
export default defineConfig({
  resolve: {
    // Test against the shared package's TypeScript source, not a stale build.
    alias: { '@etkin/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    exclude: [...configDefaults.exclude, 'test/integration/**'],
    // Each file boots PostgreSQL in WebAssembly and files run in parallel; on a
    // busy laptop or a 2-core CI runner the first test of a file can pass 5 s.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
