import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { outboxHandlers } from '../src/outbox/handlers.js';
import { drainOutbox } from '../src/outbox/processor.js';
import {
  bearer,
  createPublishedEvent,
  createTestDatabase,
  createTicketHolder,
  createUser,
  seedCheckIn,
  seedClub,
  testConfig,
} from './helpers.js';

let db: Database;
let app: App;
type User = Awaited<ReturnType<typeof createUser>>;
let staff: User;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  staff = await createUser(db);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const drain = () => drainOutbox(db, outboxHandlers);

const badgeCodes = async (userId: string) =>
  (
    await db
      .selectFrom('user_badges as ub')
      .innerJoin('badges as b', 'b.id', 'ub.badge_id')
      .select('b.code')
      .where('ub.user_id', '=', userId)
      .orderBy('b.code')
      .execute()
  ).map((row) => row.code);

async function checkInsAt(userId: string, orgId: string, times: number) {
  for (let i = 0; i < times; i++) await seedCheckIn(db, { userId, orgId, staffId: staff.id });
}

describe('badges', () => {
  it('awards "İlk Adım" once the worker sees the first real check-in', async () => {
    const owner = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner, undefined, {
      startsInMs: 30 * 60_000,
    });
    const holder = await createTicketHolder(app, db, eventId, ticketTypeIds[0] ?? '');
    const scan = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/events/${eventId}/check-ins`,
      headers: bearer(owner.token),
      payload: { qr: holder.qrAt() },
    });
    expect(scan.json().result).toBe('accepted');

    const mine = () => app.inject({ method: 'GET', url: '/me/badges', headers: bearer(holder.user.token) });
    expect((await mine()).json()).toEqual([]); // nothing until the worker runs

    expect(await drain()).toEqual({ processed: 1, failed: 0 });
    expect((await mine()).json()).toEqual([
      expect.objectContaining({ code: 'first_checkin', name: 'İlk Adım', organization: null }),
    ]);
  });

  it('awards Müdavim at the fifth check-in, not the fourth', async () => {
    const student = await createUser(db);
    const club = await seedClub(db);

    await checkInsAt(student.id, club, 4);
    await drain();
    expect(await badgeCodes(student.id)).toEqual(['first_checkin']);

    await checkInsAt(student.id, club, 1);
    await drain();
    expect(await badgeCodes(student.id)).toEqual(['first_checkin', 'regular_5']);
  });

  it('awards Kaşif for events at three different clubs', async () => {
    const student = await createUser(db);
    for (let i = 0; i < 2; i++) await checkInsAt(student.id, await seedClub(db), 1);
    await drain();
    expect(await badgeCodes(student.id)).not.toContain('explorer_3');

    await checkInsAt(student.id, await seedClub(db), 1);
    await drain();
    expect(await badgeCodes(student.id)).toContain('explorer_3');
  });

  it("counts only the club's own events for a club badge", async () => {
    const student = await createUser(db);
    const [home, elsewhere] = [await seedClub(db), await seedClub(db)];
    await db
      .insertInto('badges')
      .values({
        organization_id: home,
        code: 'home_regular',
        name: 'Kulüp Müdavimi',
        criteria: JSON.stringify({ type: 'checkin_count', gte: 2 }),
      })
      .execute();

    await checkInsAt(student.id, elsewhere, 3);
    await checkInsAt(student.id, home, 1);
    await drain();
    expect(await badgeCodes(student.id)).not.toContain('home_regular');

    await checkInsAt(student.id, home, 1);
    await drain();
    expect(await badgeCodes(student.id)).toContain('home_regular');
  });

  it('never awards twice when an event is handled again', async () => {
    const student = await createUser(db);
    await checkInsAt(student.id, await seedClub(db), 1);
    await drain();
    await db.updateTable('outbox').set({ processed_at: null }).execute();
    await drain();

    const { count } = await db
      .selectFrom('user_badges')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('user_id', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(Number(count)).toBe(1);
  });
});

describe('outbox processor', () => {
  it('rolls back a failing handler and retries it later with backoff', async () => {
    const handlers = {
      'test.fails': async (trx: Database) => {
        await trx.insertInto('organizations').values({ slug: 'written-by-failed-handler', name: 'x' }).execute();
        throw new Error('push service unreachable');
      },
    };
    await db.updateTable('outbox').set({ processed_at: new Date() }).where('processed_at', 'is', null).execute();
    const { id } = await db
      .insertInto('outbox')
      .values({ topic: 'test.fails', payload: JSON.stringify({}) })
      .returning('id')
      .executeTakeFirstOrThrow();

    expect(await drainOutbox(db, handlers)).toEqual({ processed: 0, failed: 1 });
    const row = await db.selectFrom('outbox').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ attempts: 1, processed_at: null, last_error: 'Error: push service unreachable' });
    expect(row.available_at.getTime()).toBeGreaterThan(Date.now());

    const leaked = await db
      .selectFrom('organizations')
      .select('id')
      .where('slug', '=', 'written-by-failed-handler')
      .execute();
    expect(leaked).toEqual([]);
    expect(await drainOutbox(db, handlers)).toEqual({ processed: 0, failed: 0 }); // not due yet
  });

  it('marks events nobody handles as processed so they do not pile up', async () => {
    await db
      .insertInto('outbox')
      .values({ topic: 'test.unknown', payload: JSON.stringify({}) })
      .execute();
    expect(await drainOutbox(db, {})).toMatchObject({ processed: 1 });
  });
});
