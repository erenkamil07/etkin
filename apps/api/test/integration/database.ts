import { recreateDatabase } from '../../scripts/fresh-database.js';
import { createDatabase, type Database } from '../../src/db.js';

const DEFAULT_URL = 'postgres://etkin:etkin@localhost:5432/etkin_test';

/**
 * A freshly migrated database on a real PostgreSQL server (docker-compose
 * locally, a service container in CI), wiped on every run.
 */
export async function createIntegrationDatabase(): Promise<Database> {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  await recreateDatabase(url);
  // Enough connections that concurrent requests really overlap.
  return createDatabase(url, 30);
}
