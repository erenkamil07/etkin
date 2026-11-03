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
  },
});
