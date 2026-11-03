import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

const MIGRATIONS = new URL('../../../db/migrations/', import.meta.url);

/**
 * Creates the database in `url` if needed, wipes its schema and applies every
 * migration. Used by the integration tests and the load test. Because it
 * wipes, it only accepts throwaway databases named *_test or *_load.
 */
export async function recreateDatabase(url: string): Promise<void> {
  const parsed = new URL(url);
  const name = parsed.pathname.slice(1);
  if (!/^[a-z0-9_]+_(test|load)$/.test(name)) {
    throw new Error(`Refusing to wipe "${name}": only databases named *_test or *_load are recreated`);
  }

  const adminUrl = new URL(parsed);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (rowCount === 0) await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: url });
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
}
