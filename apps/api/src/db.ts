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

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === '23505' &&
    'constraint' in err &&
    err.constraint === constraint
  );
}
