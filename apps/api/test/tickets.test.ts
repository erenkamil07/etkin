import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { bearer, createPublishedEvent, createTestDatabase, createUser, grantPoints, testConfig } from './helpers.js';

let db: Database;
let app: App;
type User = Awaited<ReturnType<typeof createUser>>;
let owner: User;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  owner = await createUser(db);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const claim = (user: User, eventId: string, ticketTypeId: string) =>
  app.inject({
    method: 'POST',
    url: `/events/${eventId}/tickets`,
    headers: bearer(user.token),
    payload: { ticketTypeId },
  });

const issued = async (ticketTypeId: string) =>
  (await db.selectFrom('ticket_types').select('issued_count').where('id', '=', ticketTypeId).executeTakeFirstOrThrow())
    .issued_count;

describe('claiming', () => {
  it('issues a ticket and takes a seat', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const [standard = ''] = ticketTypeIds;
    const student = await createUser(db);

    const res = await claim(student, eventId, standard);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'active',
      checkedInAt: null,
      ticketType: { id: standard, name: 'Standart' },
      event: { id: eventId, title: 'Test Event', status: 'published' },
    });
    expect(await issued(standard)).toBe(1);

    const mine = await app.inject({ method: 'GET', url: '/me/tickets', headers: bearer(student.token) });
    expect(mine.json().map((t: { id: string }) => t.id)).toEqual([res.json().id]);
  });

  it('returns the same ticket when a claim is repeated', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const [standard = ''] = ticketTypeIds;
    const student = await createUser(db);

    const first = await claim(student, eventId, standard);
    const retry = await claim(student, eventId, standard);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(first.json().id);
    expect(await issued(standard)).toBe(1);
  });

  it('allows one ticket per event', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      { name: 'Standart', capacity: 10 },
      { name: 'VIP', capacity: 10 },
    ]);
    const [standard = '', vip = ''] = ticketTypeIds;
    const student = await createUser(db);
    await claim(student, eventId, standard);

    const second = await claim(student, eventId, vip);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('ALREADY_HAS_TICKET');
  });

  it('stops at capacity', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [{ name: 'Son koltuk', capacity: 1 }]);
    const [lastSeat = ''] = ticketTypeIds;
    expect((await claim(await createUser(db), eventId, lastSeat)).statusCode).toBe(201);

    const late = await claim(await createUser(db), eventId, lastSeat);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('SOLD_OUT');
    expect(await issued(lastSeat)).toBe(1);
  });

  it('hides drafts and refuses cancelled events', async () => {
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const [standard = ''] = ticketTypeIds;
    await app.inject({ method: 'POST', url: `/orgs/${orgId}/events/${eventId}/cancel`, headers: bearer(owner.token) });
    const cancelled = await claim(await createUser(db), eventId, standard);
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().code).toBe('EVENT_NOT_OPEN');

    await db.updateTable('events').set({ status: 'draft' }).where('id', '=', eventId).execute();
    const draft = await claim(await createUser(db), eventId, standard);
    expect(draft.statusCode).toBe(404);
  });
});

describe('sales rules', () => {
  it('respects the sales window', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      { name: 'Yakında', capacity: 10, salesStartsAt: at(DAY) },
      { name: 'Kapandı', capacity: 10 },
    ]);
    const [upcoming = '', closed = ''] = ticketTypeIds;
    await db
      .updateTable('ticket_types')
      .set({ sales_starts_at: new Date(Date.now() - 2 * DAY), sales_ends_at: new Date(Date.now() - DAY) })
      .where('id', '=', closed)
      .execute();

    const early = await claim(await createUser(db), eventId, upcoming);
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('SALES_NOT_OPEN');

    const late = await claim(await createUser(db), eventId, closed);
    expect(late.json().code).toBe('SALES_CLOSED');
  });

  it('requires club points when the organizer asks for them', async () => {
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      { name: 'Sadık üyeler', capacity: 10, minPointsRequired: 3 },
    ]);
    const [loyal = ''] = ticketTypeIds;
    const student = await createUser(db);

    const refused = await claim(student, eventId, loyal);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({
      code: 'NOT_ENOUGH_POINTS',
      detail: 'Requires 3 points from this club; you have 0',
    });

    await grantPoints(db, student.id, orgId, 3);
    expect((await claim(student, eventId, loyal)).statusCode).toBe(201);
  });

  it('only counts points earned in the hosting club', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      { name: 'Sadık üyeler', capacity: 10, minPointsRequired: 3 },
    ]);
    const otherClub = await createPublishedEvent(app, owner);
    const student = await createUser(db);
    await grantPoints(db, student.id, otherClub.orgId, 50);

    const res = await claim(student, eventId, ticketTypeIds[0] ?? '');
    expect(res.json().code).toBe('NOT_ENOUGH_POINTS');
  });

  it('opens early for members above the priority threshold', async () => {
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      {
        name: 'VIP Workshop',
        capacity: 5,
        allocationMode: 'priority',
        priorityPointsThreshold: 5,
        prioritySalesStartsAt: at(-HOUR),
        salesStartsAt: at(DAY),
      },
    ]);
    const [vip = ''] = ticketTypeIds;
    const newcomer = await createUser(db);
    const regular = await createUser(db);
    await grantPoints(db, regular.id, orgId, 5);

    const waiting = await claim(newcomer, eventId, vip);
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json().detail).toMatch(/^Early access is for members with 5\+ points/);
    expect((await claim(regular, eventId, vip)).statusCode).toBe(201);
  });

  it('keeps early access after spending points', async () => {
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      { name: 'Sadık üyeler', capacity: 10, minPointsRequired: 3 },
    ]);
    const student = await createUser(db);
    await grantPoints(db, student.id, orgId, 3);
    await db
      .insertInto('point_ledger')
      .values({ user_id: student.id, organization_id: orgId, delta: -3, reason: 'redemption' })
      .execute();

    expect((await claim(student, eventId, ticketTypeIds[0] ?? '')).statusCode).toBe(201);
  });

  it('sends lottery ticket types to the application flow', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      { name: 'Çekiliş', capacity: 5, allocationMode: 'lottery' },
    ]);
    const res = await claim(await createUser(db), eventId, ticketTypeIds[0] ?? '');
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LOTTERY_ONLY');
  });
});

describe('cancelling', () => {
  const cancel = (user: User, ticketId: string) =>
    app.inject({ method: 'POST', url: `/tickets/${ticketId}/cancel`, headers: bearer(user.token) });

  it('gives the seat back and lets the holder claim again', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [{ name: 'Standart', capacity: 1 }]);
    const [standard = ''] = ticketTypeIds;
    const student = await createUser(db);
    const ticket = (await claim(student, eventId, standard)).json();

    const res = await cancel(student, ticket.id);
    expect(res.json()).toMatchObject({ status: 'cancelled', cancelledAt: expect.any(String) });
    expect(await issued(standard)).toBe(0);
    expect((await cancel(student, ticket.id)).statusCode).toBe(200);
    expect(await issued(standard)).toBe(0);

    const again = await claim(student, eventId, standard);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).not.toBe(ticket.id);
  });

  it('keeps tickets private to their holder', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const student = await createUser(db);
    const stranger = await createUser(db);
    const ticket = (await claim(student, eventId, ticketTypeIds[0] ?? '')).json();

    expect((await cancel(stranger, ticket.id)).statusCode).toBe(404);
    const peek = await app.inject({ method: 'GET', url: `/tickets/${ticket.id}`, headers: bearer(stranger.token) });
    expect(peek.statusCode).toBe(404);
  });

  it('refuses after check-in or once the event has started', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [{ name: 'Standart', capacity: 10 }]);
    const [standard = ''] = ticketTypeIds;
    const usedHolder = await createUser(db);
    const used = (await claim(usedHolder, eventId, standard)).json();
    await db
      .updateTable('tickets')
      .set({ status: 'checked_in', checked_in_at: new Date() })
      .where('id', '=', used.id)
      .execute();
    expect((await cancel(usedHolder, used.id)).json().code).toBe('ALREADY_CHECKED_IN');

    const lateHolder = await createUser(db);
    const late = (await claim(lateHolder, eventId, standard)).json();
    await db
      .updateTable('events')
      .set({ starts_at: new Date(Date.now() - HOUR) })
      .where('id', '=', eventId)
      .execute();
    expect((await cancel(lateHolder, late.id)).json().code).toBe('TOO_LATE_TO_CANCEL');
  });

  it("cancels every holder's ticket when the event is cancelled", async () => {
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const student = await createUser(db);
    const ticket = (await claim(student, eventId, ticketTypeIds[0] ?? '')).json();

    await app.inject({ method: 'POST', url: `/orgs/${orgId}/events/${eventId}/cancel`, headers: bearer(owner.token) });
    const after = await app.inject({ method: 'GET', url: `/tickets/${ticket.id}`, headers: bearer(student.token) });
    expect(after.json()).toMatchObject({ status: 'cancelled', event: { status: 'cancelled' } });
  });
});
