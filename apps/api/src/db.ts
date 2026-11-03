import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { DB } from './db/schema.js';

export type Database = Kysely<DB>;

export function createDatabase(url: string, poolMax: number): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: poolMax }) }),
  });
}

export async function pingDatabase(db: Database): Promise<void> {
  await sql`select 1`.execute(db);
}
