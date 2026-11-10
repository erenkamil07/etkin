import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { createQrPayload, decodeTicketKey } from '@etkin/shared';
import { Kysely, PGliteDialect } from 'kysely';
import type { App } from '../src/app.js';
import { createAccessTokens } from '../src/auth/tokens.js';
import { loadConfig } from '../src/config.js';
import type { DB, PlatformRole } from '../src/db/schema.js';
import type { Database } from '../src/db.js';

export const testConfig = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://etkin:etkin@localhost:5432/etkin',
  REDIS_URL: 'redis://localhost:6379/0',
  JWT_ACCESS_SECRET: 'test-only-secret-that-is-at-least-32-characters',
  QR_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
});

const MIGRATIONS = new URL('../../../db/migrations/', import.meta.url);

/** A throwaway in-process PostgreSQL 18 (PGlite) with every migration applied. */
export async function createTestDatabase(): Promise<Database> {
  const pglite = new PGlite({ extensions: { citext } });
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const [up = ''] = readFileSync(new URL(file, MIGRATIONS), 'utf8').split('-- migrate:down');
    await pglite.exec(up.replace('-- migrate:up', ''));
  }
  return new Kysely<DB>({ dialect: new PGliteDialect({ pglite }) });
}

const accessTokens = createAccessTokens(testConfig.JWT_ACCESS_SECRET, testConfig.ACCESS_TOKEN_TTL_SECONDS);
let userCounter = 0;

/**
 * Inserts a user straight into the database and signs an access token for them,
 * skipping /auth/register (argon2 cost, sign-up rate limit) where auth isn't under test.
 */
export async function createUser(db: Database, platformRole: PlatformRole = 'user') {
  const n = ++userCounter;
  const user = await db
    .insertInto('users')
    .values({ email: `member${n}@uni.edu.tr`, full_name: `Member ${n}`, platform_role: platformRole })
    .returning(['id', 'email'])
    .executeTakeFirstOrThrow();
  return { ...user, token: await accessTokens.sign({ id: user.id, platformRole }) };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** What every club application has to say, for tests that need a club but aren't about applying. */
export const CLUB_APPLICATION = { applicantRole: 'president', verificationLink: '@testclub' } as const;

/** The same person, as a platform admin: a club an admin creates is approved straight away. */
export const adminTokenFor = (userId: string) => accessTokens.sign({ id: userId, platformRole: 'admin' });

let clubCounter = 0;

/**
 * A new, approved club owned by `owner` with one published event a week from
 * now, built through the API. Returns the ids tests need.
 */
export async function createPublishedEvent(
  app: App,
  owner: { id: string; token: string },
  ticketTypes: Record<string, unknown>[] = [{ name: 'Standart', capacity: 50 }],
  /** startsInMs: 30 minutes puts the event inside its check-in window (doors open an hour early). */
  { startsInMs = 7 * 24 * 3_600_000, event = {} }: { startsInMs?: number; event?: Record<string, unknown> } = {},
) {
  const headers = bearer(owner.token);
  const ok = async (res: { statusCode: number; body: string; json: () => { id: string } }, status: number) => {
    if (res.statusCode !== status) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
    return res.json().id;
  };

  const orgId = await ok(
    await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: bearer(await adminTokenFor(owner.id)),
      payload: { slug: `club-${++clubCounter}-${Date.now()}`, name: 'Test Club', ...CLUB_APPLICATION },
    }),
    201,
  );
  const startsAt = Date.now() + startsInMs;
  const eventId = await ok(
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/events`,
      headers,
      payload: {
        title: 'Test Event',
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(startsAt + 2 * 3_600_000).toISOString(),
        ...event,
      },
    }),
    201,
  );
  const ticketTypeIds: string[] = [];
  for (const payload of ticketTypes) {
    ticketTypeIds.push(
      await ok(
        await app.inject({ method: 'POST', url: `/orgs/${orgId}/events/${eventId}/ticket-types`, headers, payload }),
        201,
      ),
    );
  }
  await ok(await app.inject({ method: 'POST', url: `/orgs/${orgId}/events/${eventId}/publish`, headers }), 200);
  return { orgId, eventId, ticketTypeIds };
}

/**
 * A student holding a ticket, with their phone's QR key: `qrAt()` renders the
 * code the phone would show at that moment, exactly as the app will.
 */
export async function createTicketHolder(
  app: App,
  db: Database,
  eventId: string,
  ticketTypeId: string,
  deviceId = 'phone-1',
) {
  const user = await createUser(db);
  const claim = await app.inject({
    method: 'POST',
    url: `/events/${eventId}/tickets`,
    headers: bearer(user.token),
    payload: { ticketTypeId },
  });
  if (claim.statusCode !== 201) throw new Error(`setup failed: ${claim.statusCode} ${claim.body}`);
  const ticketId: string = claim.json().id;
  const keyResponse = await app.inject({
    method: 'POST',
    url: `/tickets/${ticketId}/qr-key`,
    headers: bearer(user.token),
    payload: { deviceId },
  });
  const key = decodeTicketKey(keyResponse.json().key);
  return { user, ticketId, qrAt: (nowMs: number = Date.now()) => createQrPayload(key, ticketId, nowMs) };
}

let seedCounter = 0;

export async function seedClub(db: Database) {
  const n = ++seedCounter;
  return (
    await db
      .insertInto('organizations')
      .values({ slug: `seeded-club-${n}`, name: `Seeded Club ${n}`, status: 'approved' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}

/**
 * Writes a completed check-in straight to the database, with its ledger entry
 * and outbox event, as the door would. For tests about what happens after
 * check-ins (badges, points, stats) that need many of them quickly.
 */
export async function seedCheckIn(
  db: Database,
  { userId, orgId, staffId, points = 1 }: { userId: string; orgId: string; staffId: string; points?: number },
) {
  const now = Date.now();
  const at = (offsetMs: number) => new Date(now + offsetMs);
  const event = await db
    .insertInto('events')
    .values({
      organization_id: orgId,
      title: `Seeded Event ${++seedCounter}`,
      status: 'published',
      starts_at: at(-3_600_000),
      ends_at: at(3_600_000),
      checkin_opens_at: at(-7_200_000),
      checkin_closes_at: at(3_600_000),
      checkin_points: points,
      created_by: staffId,
    })
    .returning(['id', 'title'])
    .executeTakeFirstOrThrow();
  const type = await db
    .insertInto('ticket_types')
    .values({
      event_id: event.id,
      name: 'Standart',
      capacity: 10,
      issued_count: 1,
      sales_starts_at: at(-86_400_000),
      sales_ends_at: at(-3_600_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const ticket = await db
    .insertInto('tickets')
    .values({
      ticket_type_id: type.id,
      event_id: event.id,
      user_id: userId,
      status: 'checked_in',
      checked_in_at: at(0),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const checkIn = await db
    .insertInto('check_ins')
    .values({ ticket_id: ticket.id, event_id: event.id, user_id: userId, scanned_by: staffId })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (points > 0) {
    await db
      .insertInto('point_ledger')
      .values({ user_id: userId, organization_id: orgId, delta: points, reason: 'checkin', check_in_id: checkIn.id })
      .execute();
  }
  await db
    .insertInto('outbox')
    .values({
      topic: 'checkin.accepted',
      payload: JSON.stringify({
        checkInId: checkIn.id,
        ticketId: ticket.id,
        eventId: event.id,
        userId,
        organizationId: orgId,
        points,
      }),
    })
    .execute();
  return { eventId: event.id, eventTitle: event.title, checkInId: checkIn.id };
}

/** Credits club points through the ledger (the balance trigger does the rest). */
export async function grantPoints(db: Database, userId: string, orgId: string, points: number) {
  await db
    .insertInto('point_ledger')
    .values({ user_id: userId, organization_id: orgId, delta: points, reason: 'bonus' })
    .execute();
}

const jpegSegment = (marker: number, payload: Buffer) => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
};

/** A JPEG's segment structure (the parser never decodes pixels), optionally with GPS in its EXIF. */
export function fakeJpeg({ width = 1200, height = 1697, gps = false, padding = 0 } = {}) {
  const frame = Buffer.alloc(15);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    gps ? jpegSegment(0xe1, Buffer.from('Exif\0\0GPSLatitude=36.78;GPSLongitude=34.53', 'latin1')) : Buffer.alloc(0),
    jpegSegment(0xfe, Buffer.from('taken on a phone')),
    jpegSegment(0xc0, frame),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from('compressed-image-data'),
    Buffer.alloc(padding),
    Buffer.from([0xff, 0xd9]),
  ]);
}
