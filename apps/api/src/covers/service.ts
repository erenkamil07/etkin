import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { cleanJpeg, NotAJpegError } from './jpeg.js';

/** The app sends about 200 KB; this leaves room for a big poster from elsewhere. */
export const MAX_COVER_BYTES = 1_572_864;

interface CoverRow {
  version: string;
  width: number;
  height: number;
}

/** Where the app loads the poster from (relative to the API), with its size for layout. */
const coverOf = (eventId: string, row: CoverRow) => ({
  url: `/events/${eventId}/cover?v=${row.version}`,
  width: row.width,
  height: row.height,
});

export const coverRef = (eventId: string, row: CoverRow | null) => (row ? coverOf(eventId, row) : null);

/** For event SELECTs aliased `e`: the poster's version and size, or null. */
export const coverColumn = sql<CoverRow | null>`(
  select json_build_object('version', c.version, 'width', c.width, 'height', c.height)
  from event_covers c where c.event_id = e.id
)`.as('cover');

async function editableEvent(db: Database, orgId: string, eventId: string) {
  const event = await db
    .selectFrom('events')
    .select('status')
    .where('id', '=', eventId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');
  if (event.status === 'cancelled' || event.status === 'completed') {
    throw new AppError(409, 'EVENT_NOT_EDITABLE', `A ${event.status} event can no longer be changed`);
  }
}

/** Stores the poster without its metadata (EXIF, GPS, XMP), replacing any earlier one. */
export async function saveCover(db: Database, orgId: string, eventId: string, body: unknown) {
  await editableEvent(db, orgId, eventId);
  if (!Buffer.isBuffer(body)) throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Send the poster as image/jpeg');
  let image: ReturnType<typeof cleanJpeg>;
  try {
    image = cleanJpeg(body);
  } catch (err) {
    if (err instanceof NotAJpegError) throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Posters must be JPEG images');
    throw err;
  }
  const row = {
    data: image.data,
    width: image.width,
    height: image.height,
    version: createHash('sha256').update(image.data).digest('base64url').slice(0, 12),
  };
  await db
    .insertInto('event_covers')
    .values({ event_id: eventId, ...row })
    .onConflict((oc) => oc.column('event_id').doUpdateSet({ ...row, updated_at: new Date() }))
    .execute();
  return coverOf(eventId, row);
}

export async function deleteCover(db: Database, orgId: string, eventId: string) {
  await editableEvent(db, orgId, eventId);
  await db.deleteFrom('event_covers').where('event_id', '=', eventId).execute();
}

export async function loadCover(db: Database, eventId: string) {
  return db.selectFrom('event_covers').select(['data', 'version']).where('event_id', '=', eventId).executeTakeFirst();
}
