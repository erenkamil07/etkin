// Writes the API's OpenAPI document to apps/api/openapi.json. The mobile app
// generates its typed client from it (`pnpm api:types`), and CI fails if
// either file is stale.
import { writeFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Database } from '../src/db.js';

const app = await buildApp({
  config: loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused@localhost/unused',
    REDIS_URL: 'redis://localhost',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    QR_MASTER_KEY: Buffer.alloc(32).toString('base64'),
  }),
  db: {} as Database, // routes are only registered here, never called
  readinessChecks: {},
});
await app.ready();
writeFileSync(new URL('../openapi.json', import.meta.url), `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
