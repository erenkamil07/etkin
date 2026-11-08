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

const DAY_MS = 86_400_000;
/** After choosing a university: this long to fix a wrong pick, then one change per year. */
export const UNIVERSITY_GRACE_MS = 7 * DAY_MS;
export const UNIVERSITY_LOCK_MS = 365 * DAY_MS;

/**
 * Until when a student's university is fixed, or null if they may change it now:
 * never chosen, still in the first week, or chosen over a year ago. University-only
 * events rely on this, or anyone could switch campus for a ticket and back.
 */
export function universityLockedUntil(chosenAt: Date | null, now = new Date()): Date | null {
  if (!chosenAt) return null;
  const age = now.getTime() - chosenAt.getTime();
  if (age < UNIVERSITY_GRACE_MS || age >= UNIVERSITY_LOCK_MS) return null;
  return new Date(chosenAt.getTime() + UNIVERSITY_LOCK_MS);
}

/**
 * When the choice was made, after a change: a change in the free first week keeps
 * the original date (the week isn't renewed); any other change starts a new one.
 */
export function nextUniversityChosenAt(chosenAt: Date | null, now = new Date()): Date {
  if (chosenAt && now.getTime() - chosenAt.getTime() < UNIVERSITY_GRACE_MS) return chosenAt;
  return now;
}

/** `{ id, name }`, or null for no university. */
export function universityRef(id: number | null, name: string | null) {
  return id === null || name === null ? null : { id, name };
}
