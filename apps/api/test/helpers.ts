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

let clubCounter = 0;

/**
 * A new club owned by `owner` with one published event a week from now,
 * built through the API. Returns the ids tests need.
 */
export async function createPublishedEvent(
  app: App,
  owner: { token: string },
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
      headers,
      payload: { slug: `club-${++clubCounter}-${Date.now()}`, name: 'Test Club' },
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

/** Credits club points through the ledger (the balance trigger does the rest). */
export async function grantPoints(db: Database, userId: string, orgId: string, points: number) {
  await db
    .insertInto('point_ledger')
    .values({ user_id: userId, organization_id: orgId, delta: points, reason: 'bonus' })
    .execute();
}
