import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { createDatabase, type Database } from '../../src/db.js';

const MIGRATIONS = new URL('../../../../db/migrations/', import.meta.url);
const DEFAULT_URL = 'postgres://etkin:etkin@localhost:5432/etkin_test';

/**
 * A freshly migrated database on a real PostgreSQL server (docker-compose
 * locally, a service container in CI). Its schema is wiped on every run, so
 * only databases named *_test are accepted.
 */
export async function createIntegrationDatabase(): Promise<Database> {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to wipe "${name}": integration tests only use databases named *_test`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (rowCount === 0) await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('drop schema public cascade; create schema public;');
    const files = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const [up = ''] = readFileSync(new URL(file, MIGRATIONS), 'utf8').split('-- migrate:down');
      await client.query(up.replace('-- migrate:up', ''));
    }
  } finally {
    await client.end();
  }

  // Enough connections that concurrent requests really overlap.
  return createDatabase(url.toString(), 30);
}
