import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { Kysely, PGliteDialect } from 'kysely';
import { loadConfig } from '../src/config.js';
import type { Database } from '../src/db.js';
import type { DB } from '../src/db/schema.js';

export const testConfig = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://etkin:etkin@localhost:5432/etkin',
  REDIS_URL: 'redis://localhost:6379/0',
  JWT_ACCESS_SECRET: 'test-only-secret-that-is-at-least-32-characters',
});

const MIGRATIONS = new URL('../../../db/migrations/', import.meta.url);

/** A throwaway in-process PostgreSQL 18 (PGlite) with every migration applied. */
export async function createTestDatabase(): Promise<Database> {
  const pglite = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const [up = ''] = readFileSync(new URL(file, MIGRATIONS), 'utf8').split('-- migrate:down');
    await pglite.exec(up.replace('-- migrate:up', ''));
  }
  return new Kysely<DB>({ dialect: new PGliteDialect({ pglite }) });
}
