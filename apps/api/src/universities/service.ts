import { sql } from 'kysely';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';

/** Every university, in Turkish alphabetical order. The list changes once a year at most. */
export async function listUniversities(db: Database) {
  const rows = await db.selectFrom('universities').select(['id', 'name', 'city']).execute();
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** 400 for an id that isn't in the list; null and undefined pass (no university, or no change). */
export async function assertUniversity(db: Database, id: number | null | undefined) {
  if (id === null || id === undefined) return;
  const found = await db.selectFrom('universities').select('id').where('id', '=', id).executeTakeFirst();
  if (!found) throw new AppError(400, 'UNKNOWN_UNIVERSITY', 'universityId is not in GET /universities');
}

/**
 * The name of the university a row points at, for SELECT and RETURNING lists:
 * `universityName('users.university_id')` reads as `university_name`.
 */
export const universityName = (column: string) =>
  sql<string | null>`(select u.name from universities u where u.id = ${sql.ref(column)})`.as('university_name');

/** `{ id, name }`, or null for no university. */
export function universityRef(id: number | null, name: string | null) {
  return id === null || name === null ? null : { id, name };
}
