import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { completeEndedEvents } from '../src/events/service.js';
import {
  bearer,
  createPublishedEvent,
  createTestDatabase,
  createTicketHolder,
  createUser,
  grantPoints,
  seedCheckIn,
  seedClub,
  testConfig,
} from './helpers.js';

let db: Database;
let app: App;
type User = Awaited<ReturnType<typeof createUser>>;
let owner: User;
let scanner: User;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  owner = await createUser(db);
  scanner = await createUser(db);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const get = (user: User, url: string) => app.inject({ method: 'GET', url, headers: bearer(user.token) });

describe('my points', () => {
  it('breaks points down by club with a readable history', async () => {
    const student = await createUser(db);
    const [ieee, acm] = [await seedClub(db), await seedClub(db)];
    const workshop = await seedCheckIn(db, { userId: student.id, orgId: ieee, staffId: scanner.id, points: 3 });
    await seedCheckIn(db, { userId: student.id, orgId: acm, staffId: scanner.id, points: 1 });
    await grantPoints(db, student.id, acm, 2);
    await db
      .insertInto('point_ledger')
      .values({ user_id: student.id, organization_id: ieee, delta: -2, reason: 'redemption', note: 'Kahve kuponu' })
      .execute();

    const points = (await get(student, '/me/points')).json();
    expect(points).toMatchObject({ balance: 4, lifetimeEarned: 6 });
    expect(points.clubs.map((c: { balance: number; lifetimeEarned: number }) => [c.balance, c.lifetimeEarned])).toEqual(
      [
        [1, 3],
        [3, 3],
      ],
    );
    expect(points.history.map((h: { reason: string; delta: number }) => [h.reason, h.delta])).toEqual([
      ['redemption', -2],
      ['bonus', 2],
      ['checkin', 1],
      ['checkin', 3],
    ]);
    expect(points.history[0]).toMatchObject({ note: 'Kahve kuponu', event: null });
    expect(points.history[3].event).toEqual({ id: workshop.eventId, title: workshop.eventTitle });
  });

  it('starts empty', async () => {
    const newcomer = await createUser(db);
    expect((await get(newcomer, '/me/points')).json()).toEqual({
      balance: 0,
      lifetimeEarned: 0,
      clubs: [],
      history: [],
    });
  });
});

describe('event stats', () => {
  async function staffedEvent() {
    const event = await createPublishedEvent(
      app,
      owner,
      [
        { name: 'Standart', capacity: 50 },
        { name: 'VIP', capacity: 5 },
      ],
      { startsInMs: 30 * 60_000 },
    );
    await app.inject({
      method: 'POST',
      url: `/orgs/${event.orgId}/members`,
      headers: bearer(owner.token),
      payload: { email: scanner.email, role: 'scanner' },
    });
    const scan = (qr: string, gate: string) =>
      app.inject({
        method: 'POST',
        url: `/orgs/${event.orgId}/events/${event.eventId}/check-ins`,
        headers: bearer(scanner.token),
        payload: { qr, gate },
      });
    return { ...event, scan, stats: () => get(owner, `/orgs/${event.orgId}/events/${event.eventId}/stats`) };
  }

  it('counts tickets, arrivals, gates and scan outcomes', async () => {
    const event = await staffedEvent();
    const [standard = '', vip = ''] = event.ticketTypeIds;
    const ayse = await createTicketHolder(app, db, event.eventId, standard);
    const mehmet = await createTicketHolder(app, db, event.eventId, vip);
    const leaver = await createTicketHolder(app, db, event.eventId, standard);
    await app.inject({ method: 'POST', url: `/tickets/${leaver.ticketId}/cancel`, headers: bearer(leaver.user.token) });

    await event.scan(ayse.qrAt(), 'Kapı A');
    await event.scan(mehmet.qrAt(), 'Kapı B');
    await event.scan(ayse.qrAt(), 'Kapı B');
    await event.scan('not-a-ticket', 'Kapı A');

    const stats = (await event.stats()).json();
    expect(stats.tickets).toEqual({
      issued: 2,
      checkedIn: 2,
      cancelled: 1,
      waiting: 0,
      noShows: null,
      attendanceRate: 1,
    });
    expect(stats.byTicketType).toEqual([
      expect.objectContaining({ name: 'Standart', capacity: 50, issued: 1, checkedIn: 1 }),
      expect.objectContaining({ name: 'VIP', capacity: 5, issued: 1, checkedIn: 1 }),
    ]);
    expect(stats.arrivals.reduce((sum: number, bucket: { count: number }) => sum + bucket.count, 0)).toBe(2);
    expect(new Set(stats.gates.map((g: { gate: string; count: number }) => `${g.gate}:${g.count}`))).toEqual(
      new Set(['Kapı A:1', 'Kapı B:1']),
    );
    expect(stats.scans).toEqual({
      accepted: 2,
      duplicate: 1,
      invalid_token: 1,
      expired_token: 0,
      wrong_event: 0,
      ticket_cancelled: 0,
      outside_window: 0,
    });
  });

  it('reports no-shows once the event is over, and housekeeping completes it', async () => {
    const event = await staffedEvent();
    const [standard = ''] = event.ticketTypeIds;
    const came = await createTicketHolder(app, db, event.eventId, standard);
    await createTicketHolder(app, db, event.eventId, standard);
    await event.scan(came.qrAt(), 'Kapı A');

    const past = new Date(Date.now() - 60_000);
    await db
      .updateTable('events')
      .set({ starts_at: new Date(Date.now() - 3 * 3_600_000), ends_at: past, checkin_closes_at: past })
      .where('id', '=', event.eventId)
      .execute();

    expect((await event.stats()).json().tickets).toMatchObject({ waiting: 1, noShows: 1, attendanceRate: 0.5 });
    expect(await completeEndedEvents(db)).toBeGreaterThanOrEqual(1);
    const { status } = await db
      .selectFrom('events')
      .select('status')
      .where('id', '=', event.eventId)
      .executeTakeFirstOrThrow();
    expect(status).toBe('completed');
  });

  it('finds attendees by name or student number, Turkish letters included', async () => {
    const event = await staffedEvent();
    const [standard = ''] = event.ticketTypeIds;
    const ayse = await createTicketHolder(app, db, event.eventId, standard);
    await createTicketHolder(app, db, event.eventId, standard);
    await db
      .updateTable('users')
      .set({ full_name: 'Ayşe Yılmaz', student_number: '2481234' })
      .where('id', '=', ayse.user.id)
      .execute();
    const search = (query: string, as: User = owner) =>
      get(as, `/orgs/${event.orgId}/events/${event.eventId}/attendees${query}`);

    expect((await search('?q=ayşe')).json()).toEqual([
      expect.objectContaining({ ticketId: ayse.ticketId, name: 'Ayşe Yılmaz', status: 'active' }),
    ]);
    expect((await search('?q=248')).json()).toHaveLength(1);
    expect((await search('')).json()).toHaveLength(2);
    expect((await search('?q=%25')).json()).toHaveLength(0); // a literal "%" matches nothing, not everything
    expect((await search('', scanner)).statusCode).toBe(403);
  });
});
