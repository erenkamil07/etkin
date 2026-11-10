import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { adminTokenFor, bearer, CLUB_APPLICATION, createTestDatabase, createUser, testConfig } from './helpers.js';

let db: Database;
let app: App;

type User = Awaited<ReturnType<typeof createUser>>;
let orgId: string;
let owner: User;
let organizer: User;
let scanner: User;
let outsider: User;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/** An approved club of `owner` (created with their admin token; applying is tested in applications.test). */
async function newClub(slug: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: bearer(await adminTokenFor(owner.id)),
    payload: { slug, name: `Club ${slug}`, ...CLUB_APPLICATION },
  });
  return res.json().id as string;
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  owner = await createUser(db);
  organizer = await createUser(db);
  scanner = await createUser(db);
  outsider = await createUser(db);
  orgId = await newClub('gdg-boun');
  for (const [user, role] of [
    [organizer, 'organizer'],
    [scanner, 'scanner'],
  ] as const) {
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: bearer(owner.token),
      payload: { email: user.email, role },
    });
  }
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

function createEvent(payload: Record<string, unknown> = {}, as: User = organizer, club = orgId) {
  return app.inject({
    method: 'POST',
    url: `/orgs/${club}/events`,
    headers: bearer(as.token),
    payload: { title: 'Cloud 101 Workshop', startsAt: at(7 * DAY), endsAt: at(7 * DAY + 2 * HOUR), ...payload },
  });
}

async function draft(payload: Record<string, unknown> = {}, club = orgId) {
  const res = await createEvent(payload, club === orgId ? organizer : owner, club);
  expect(res.statusCode).toBe(201);
  return res.json();
}

const manage = (method: 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object, as: User = organizer) =>
  app.inject({ method, url: `/orgs/${orgId}/events${path}`, headers: bearer(as.token), ...(payload && { payload }) });

const addTicketType = (eventId: string, payload: Record<string, unknown>) =>
  manage('POST', `/${eventId}/ticket-types`, { name: 'Standart', capacity: 50, ...payload });

const view = (eventId: string, as?: User) =>
  app.inject({ method: 'GET', url: `/events/${eventId}`, ...(as && { headers: bearer(as.token) }) });

describe('drafts', () => {
  it('creates a draft with a default check-in window and 1 point', async () => {
    const event = await draft();
    expect(event).toMatchObject({ status: 'draft', checkinPoints: 1, publishedAt: null, ticketTypes: [] });
    expect(event.organization).toMatchObject({ id: orgId, slug: 'gdg-boun' });
    expect(Date.parse(event.startsAt) - Date.parse(event.checkinOpensAt)).toBe(HOUR);
    expect(event.checkinClosesAt).toBe(event.endsAt);
  });

  it('accepts Istanbul local times and answers in UTC', async () => {
    const event = await draft({ startsAt: '2026-12-01T19:00:00+03:00', endsAt: '2026-12-01T21:30:00+03:00' });
    expect(event.startsAt).toBe('2026-12-01T16:00:00.000Z');
    expect(event.endsAt).toBe('2026-12-01T18:30:00.000Z');
  });

  it('rejects an end before the start, on create and on edit', async () => {
    const created = await createEvent({ endsAt: at(6 * DAY) });
    expect(created.statusCode).toBe(400);
    expect(created.json().code).toBe('INVALID_EVENT_TIMES');

    const event = await draft();
    const edited = await manage('PATCH', `/${event.id}`, { endsAt: at(DAY) });
    expect(edited.statusCode).toBe(400);
    expect(edited.json().code).toBe('INVALID_EVENT_TIMES');
  });

  it('still reports a bad check-in window the organizer sent', async () => {
    const res = await createEvent({ checkinOpensAt: at(7 * DAY), checkinClosesAt: at(6 * DAY) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_CHECKIN_WINDOW');
  });

  it('needs the organizer role', async () => {
    for (const user of [scanner, outsider]) expect((await createEvent({}, user)).statusCode).toBe(403);
  });

  it("shows drafts only to the club's team", async () => {
    const { id } = await draft();
    expect((await view(id)).statusCode).toBe(404);
    expect((await view(id, outsider)).statusCode).toBe(404);
    expect((await view(id, scanner)).statusCode).toBe(200);
    const feed = await app.inject({ method: 'GET', url: `/events?orgId=${orgId}&limit=50` });
    expect(feed.json().items.map((e: { id: string }) => e.id)).not.toContain(id);
  });

  it('deletes drafts', async () => {
    const { id } = await draft();
    expect((await manage('DELETE', `/${id}`)).statusCode).toBe(204);
    expect((await view(id, organizer)).statusCode).toBe(404);
  });
});

describe('ticket types', () => {
  it('ends sales at the event start by default', async () => {
    const event = await draft();
    const res = await addTicketType(event.id, {});
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'Standart',
      capacity: 50,
      issued: 0,
      remaining: 50,
      priceCents: 0,
      currency: 'TRY',
      allocationMode: 'fcfs',
      salesEndsAt: event.startsAt,
    });
  });

  it('checks that allocation rules are complete', async () => {
    const event = await draft();
    const incomplete = await addTicketType(event.id, { name: 'VIP', allocationMode: 'priority' });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().code).toBe('INVALID_PRIORITY_CONFIG');

    const priority = await addTicketType(event.id, {
      name: 'VIP',
      capacity: 10,
      allocationMode: 'priority',
      priorityPointsThreshold: 5,
      prioritySalesStartsAt: at(0),
      salesStartsAt: at(DAY),
    });
    expect(priority.statusCode).toBe(201);
    expect(priority.json()).toMatchObject({ allocationMode: 'priority', priorityPointsThreshold: 5 });
  });

  it('rejects a second ticket type with the same name', async () => {
    const event = await draft();
    await addTicketType(event.id, {});
    const res = await addTicketType(event.id, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('TICKET_TYPE_NAME_TAKEN');
  });

  it('never lets capacity drop below tickets already issued', async () => {
    const event = await draft();
    const type = (await addTicketType(event.id, {})).json();
    await db.updateTable('ticket_types').set({ issued_count: 10 }).where('id', '=', type.id).execute();
    const resize = (capacity: number) => manage('PATCH', `/${event.id}/ticket-types/${type.id}`, { capacity });

    const tooSmall = await resize(5);
    expect(tooSmall.statusCode).toBe(409);
    expect(tooSmall.json().code).toBe('CAPACITY_BELOW_ISSUED');
    expect((await resize(10)).json()).toMatchObject({ capacity: 10, remaining: 0 });

    const remove = await manage('DELETE', `/${event.id}/ticket-types/${type.id}`);
    expect(remove.statusCode).toBe(409);
    expect(remove.json().code).toBe('TICKET_TYPE_IN_USE');
  });

  it('deletes ticket types nobody holds', async () => {
    const event = await draft();
    const type = (await addTicketType(event.id, {})).json();
    expect((await manage('DELETE', `/${event.id}/ticket-types/${type.id}`)).statusCode).toBe(204);
    expect((await view(event.id, organizer)).json().ticketTypes).toEqual([]);
  });
});

describe('publishing and cancelling', () => {
  it('needs at least one ticket type', async () => {
    const event = await draft();
    const res = await manage('POST', `/${event.id}/publish`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('NO_TICKET_TYPES');
  });

  it('puts the event in the public feed with capacity totals', async () => {
    const club = await newClub('feed-totals');
    const event = await draft({}, club);
    const add = (name: string, capacity: number) =>
      app.inject({
        method: 'POST',
        url: `/orgs/${club}/events/${event.id}/ticket-types`,
        headers: bearer(owner.token),
        payload: { name, capacity },
      });
    const standard = (await add('Standart', 30)).json();
    await add('Öğrenci', 20);
    await db.updateTable('ticket_types').set({ issued_count: 5 }).where('id', '=', standard.id).execute();

    const published = await app.inject({
      method: 'POST',
      url: `/orgs/${club}/events/${event.id}/publish`,
      headers: bearer(owner.token),
    });
    expect(published.json()).toMatchObject({ status: 'published', publishedAt: expect.any(String) });

    const feed = await app.inject({ method: 'GET', url: `/events?orgId=${club}` });
    expect(feed.json().items).toEqual([expect.objectContaining({ id: event.id, capacity: 50, remaining: 45 })]);
    expect((await view(event.id)).statusCode).toBe(200);
  });

  it('only publishes drafts', async () => {
    const event = await draft();
    await addTicketType(event.id, {});
    await manage('POST', `/${event.id}/publish`);
    const again = await manage('POST', `/${event.id}/publish`);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('freezes a cancelled event but keeps it visible', async () => {
    const event = await draft();
    await addTicketType(event.id, {});
    await manage('POST', `/${event.id}/publish`);

    const cancelled = await manage('POST', `/${event.id}/cancel`);
    expect(cancelled.json().status).toBe('cancelled');

    const codes = await Promise.all([
      manage('PATCH', `/${event.id}`, { title: 'Renamed' }),
      addTicketType(event.id, { name: 'Late' }),
      manage('POST', `/${event.id}/cancel`),
      manage('DELETE', `/${event.id}`),
    ]).then((responses) => responses.map((res) => res.json().code));
    expect(codes).toEqual(['EVENT_NOT_EDITABLE', 'EVENT_NOT_EDITABLE', 'INVALID_STATUS_TRANSITION', 'EVENT_NOT_DRAFT']);

    expect((await view(event.id)).json().status).toBe('cancelled');
  });
});

describe('paid events', () => {
  const PAYMENT = 'Ödemeler kapıda nakit yapılmaktadır.';

  it('keeps what the price covers and how to pay with the event', async () => {
    const event = await draft({ priceIncludes: 'Yemek ve sertifika', paymentInfo: PAYMENT });
    expect(event).toMatchObject({ priceIncludes: 'Yemek ve sertifika', paymentInfo: PAYMENT });
    const edited = await manage('PATCH', `/${event.id}`, { paymentInfo: 'IBAN: TR00 0000 0000 0000 0000 0000 00' });
    expect(edited.json()).toMatchObject({
      priceIncludes: 'Yemek ve sertifika',
      paymentInfo: expect.stringContaining('IBAN'),
    });
  });

  it("won't publish a paid event that doesn't say how to pay", async () => {
    const event = await draft();
    await addTicketType(event.id, { priceCents: 15_000 });
    const refused = await manage('POST', `/${event.id}/publish`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('PAYMENT_INFO_REQUIRED');

    await manage('PATCH', `/${event.id}`, { paymentInfo: PAYMENT });
    expect((await manage('POST', `/${event.id}/publish`)).statusCode).toBe(200);
  });

  it('keeps a published event payable: no paid ticket without payment info, no removing it', async () => {
    const event = await draft();
    await addTicketType(event.id, {});
    await manage('POST', `/${event.id}/publish`);
    const paidType = await addTicketType(event.id, { name: 'VIP', priceCents: 20_000 });
    expect(paidType.json().code).toBe('PAYMENT_INFO_REQUIRED');

    await manage('PATCH', `/${event.id}`, { paymentInfo: PAYMENT });
    expect((await addTicketType(event.id, { name: 'VIP', priceCents: 20_000 })).statusCode).toBe(201);
    const cleared = await manage('PATCH', `/${event.id}`, { paymentInfo: null });
    expect(cleared.json().code).toBe('PAYMENT_INFO_REQUIRED');
  });

  it('shows the cheapest ticket in the feed', async () => {
    const club = await newClub('feed-prices');
    const event = await draft({ paymentInfo: PAYMENT }, club);
    const add = (name: string, priceCents: number) =>
      app.inject({
        method: 'POST',
        url: `/orgs/${club}/events/${event.id}/ticket-types`,
        headers: bearer(owner.token),
        payload: { name, capacity: 10, priceCents },
      });
    await add('Üye', 10_000);
    await add('Misafir', 15_000);
    await app.inject({ method: 'POST', url: `/orgs/${club}/events/${event.id}/publish`, headers: bearer(owner.token) });

    const feed = await app.inject({ method: 'GET', url: `/events?orgId=${club}` });
    expect(feed.json().items).toEqual([
      expect.objectContaining({ id: event.id, priceFromCents: 10_000, paymentInfo: PAYMENT }),
    ]);
  });
});

describe('editing', () => {
  it('moves the check-in window with the event unless one is sent', async () => {
    const event = await draft();
    const moved = (
      await manage('PATCH', `/${event.id}`, { startsAt: at(10 * DAY), endsAt: at(10 * DAY + 3 * HOUR) })
    ).json();
    expect(Date.parse(moved.startsAt) - Date.parse(moved.checkinOpensAt)).toBe(HOUR);
    expect(moved.checkinClosesAt).toBe(moved.endsAt);

    // One clock reading for all four, so a millisecond ticking between calls can't skew the gap.
    const start = Date.now() + 11 * DAY;
    const iso = (ms: number) => new Date(ms).toISOString();
    const custom = (
      await manage('PATCH', `/${event.id}`, {
        startsAt: iso(start),
        endsAt: iso(start + 3 * HOUR),
        checkinOpensAt: iso(start - 30 * 60_000),
        checkinClosesAt: iso(start + HOUR),
      })
    ).json();
    expect(Date.parse(custom.startsAt) - Date.parse(custom.checkinOpensAt)).toBe(30 * 60_000);
  });

  it("can't reach another club's event through your own club", async () => {
    const event = await draft();
    const otherClub = await newClub('other-club');
    const res = await app.inject({
      method: 'PATCH',
      url: `/orgs/${otherClub}/events/${event.id}`,
      headers: bearer(owner.token),
      payload: { title: 'Hijacked' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('EVENT_NOT_FOUND');
  });
});

describe('feed', () => {
  let club: string;
  let firstDayEventId = '';

  beforeAll(async () => {
    club = await newClub('feed-pages');
    // Created out of order so the test proves the feed sorts by start time.
    for (const day of [3, 1, 2]) {
      const event = await draft({ title: `Day ${day}`, startsAt: at(day * DAY), endsAt: at(day * DAY + HOUR) }, club);
      const base = `/orgs/${club}/events/${event.id}`;
      const headers = bearer(owner.token);
      await app.inject({
        method: 'POST',
        url: `${base}/ticket-types`,
        headers,
        payload: { name: 'Standart', capacity: 10 },
      });
      await app.inject({ method: 'POST', url: `${base}/publish`, headers });
      if (day === 1) firstDayEventId = event.id;
    }
  });

  it('pages through events soonest first', async () => {
    const first = (await app.inject({ method: 'GET', url: `/events?orgId=${club}&limit=2` })).json();
    expect(first.items.map((e: { title: string }) => e.title)).toEqual(['Day 1', 'Day 2']);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = (
      await app.inject({ method: 'GET', url: `/events?orgId=${club}&limit=2&cursor=${first.nextCursor}` })
    ).json();
    expect(second.items.map((e: { title: string }) => e.title)).toEqual(['Day 3']);
    expect(second.nextCursor).toBeNull();
  });

  it('drops events that have ended', async () => {
    await db
      .updateTable('events')
      .set({ starts_at: new Date(Date.now() - 2 * HOUR), ends_at: new Date(Date.now() - HOUR) })
      .where('id', '=', firstDayEventId)
      .execute();
    const feed = (await app.inject({ method: 'GET', url: `/events?orgId=${club}` })).json();
    expect(feed.items.map((e: { title: string }) => e.title)).toEqual(['Day 2', 'Day 3']);
  });

  it('rejects a cursor it did not issue', async () => {
    const res = await app.inject({ method: 'GET', url: '/events?cursor=not-a-cursor' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_CURSOR');
  });
});
