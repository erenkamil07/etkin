import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests: PGlite, no services. Integration tests have their own config.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'test/integration/**'],
  },
});
