import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { bearer, createPublishedEvent, createTestDatabase, createUser, testConfig } from './helpers.js';

let db: Database;
let app: App;
let mersin: number;
let odtu: number;

const DAY = 86_400_000;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  const id = async (name: string) =>
    (await db.selectFrom('universities').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
  mersin = await id('Mersin Üniversitesi');
  odtu = await id('Orta Doğu Teknik Üniversitesi');
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

async function student(universityId: number | null) {
  const user = await createUser(db);
  await db.updateTable('users').set({ university_id: universityId }).where('id', '=', user.id).execute();
  return user;
}

const claim = (token: string, eventId: string, ticketTypeId: string) =>
  app.inject({ method: 'POST', url: `/events/${eventId}/tickets`, headers: bearer(token), payload: { ticketTypeId } });

const patchClub = (token: string, orgId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/orgs/${orgId}`, headers: bearer(token), payload });

describe('university-only events', () => {
  it("take only the club's university's students", async () => {
    const owner = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    await patchClub(owner.token, orgId, { universityId: mersin });
    const open = await app.inject({
      method: 'PATCH',
      url: `/orgs/${orgId}/events/${eventId}`,
      headers: bearer(owner.token),
      payload: { universityOnly: true },
    });
    expect(open.json().universityOnly).toBe(true);
    const typeId = ticketTypeIds[0] as string;

    const outsider = await claim((await student(odtu)).token, eventId, typeId);
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json()).toMatchObject({ code: 'UNIVERSITY_ONLY', detail: expect.stringContaining('Mersin') });
    expect((await claim((await student(null)).token, eventId, typeId)).json().code).toBe('UNIVERSITY_ONLY');
    expect((await claim((await student(mersin)).token, eventId, typeId)).statusCode).toBe(201);
  });

  it('need a club with a university, and stay open to everyone by default', async () => {
    const owner = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const refused = await app.inject({
      method: 'PATCH',
      url: `/orgs/${orgId}/events/${eventId}`,
      headers: bearer(owner.token),
      payload: { universityOnly: true },
    });
    expect(refused.json().code).toBe('CLUB_HAS_NO_UNIVERSITY');

    await patchClub(owner.token, orgId, { universityId: mersin });
    expect((await claim((await student(odtu)).token, eventId, ticketTypeIds[0] as string)).statusCode).toBe(201);
  });
});

describe('changing your university', () => {
  const change = (token: string, universityId: number | null) =>
    app.inject({ method: 'PATCH', url: '/me', headers: bearer(token), payload: { universityId } });
  const chosenDaysAgo = (userId: string, days: number) =>
    db
      .updateTable('users')
      .set({ university_chosen_at: new Date(Date.now() - days * DAY) })
      .where('id', '=', userId)
      .execute();

  it('is free the first time and for a week after, then once a year', async () => {
    const user = await createUser(db);
    const first = await change(user.token, mersin);
    expect(first.json()).toMatchObject({ university: { id: mersin }, universityLockedUntil: null });

    // A wrong pick can be fixed within the week, and that doesn't renew the week.
    expect((await change(user.token, odtu)).statusCode).toBe(200);
    await chosenDaysAgo(user.id, 10);
    const locked = await change(user.token, mersin);
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ code: 'UNIVERSITY_LOCKED', until: expect.any(String) });
    expect(Date.parse(locked.json().until)).toBeGreaterThan(Date.now() + 300 * DAY);
    expect((await change(user.token, null)).json().code).toBe('UNIVERSITY_LOCKED');

    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(user.token) });
    expect(me.json().universityLockedUntil).toBe(locked.json().until);

    // Picking the same one again is not a change.
    expect((await change(user.token, odtu)).statusCode).toBe(200);

    await chosenDaysAgo(user.id, 366);
    expect((await change(user.token, mersin)).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/me', headers: bearer(user.token) })).json().universityLockedUntil,
    ).toBeNull();
  });

  it('starts the week at sign-up, and leaves it open for "not listed"', async () => {
    const register = (email: string, universityId: number | null) =>
      app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password: 'correct horse battery', fullName: 'Ali Veli', universityId },
      });
    const withUniversity = (await register('signup-uni@uni.edu.tr', mersin)).json();
    const row = await db
      .selectFrom('users')
      .select('university_chosen_at')
      .where('id', '=', withUniversity.user.id)
      .executeTakeFirstOrThrow();
    expect(row.university_chosen_at).not.toBeNull();

    const notListed = (await register('signup-none@uni.edu.tr', null)).json();
    await db
      .updateTable('users')
      .set({ created_at: new Date(Date.now() - 400 * DAY) })
      .where('id', '=', notListed.user.id)
      .execute();
    expect((await change(notListed.accessToken, odtu)).statusCode).toBe(200);
  });
});

describe('the no-show rule', () => {
  /** A past event of the club with one ticket for `userId`, as the door left it. */
  async function pastEvent(
    orgId: string,
    staffId: string,
    userId: string,
    endedDaysAgo: number,
    ticket: 'active' | 'cancelled' | 'checked_in',
  ) {
    const end = new Date(Date.now() - endedDaysAgo * DAY);
    const start = new Date(end.getTime() - 2 * 3_600_000);
    const event = await db
      .insertInto('events')
      .values({
        organization_id: orgId,
        title: 'Past event',
        status: 'completed',
        starts_at: start,
        ends_at: end,
        checkin_opens_at: new Date(start.getTime() - 3_600_000),
        checkin_closes_at: end,
        created_by: staffId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const type = await db
      .insertInto('ticket_types')
      .values({
        event_id: event.id,
        name: 'Standart',
        capacity: 10,
        issued_count: 1,
        sales_starts_at: new Date(start.getTime() - 10 * DAY),
        sales_ends_at: start,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const row = await db
      .insertInto('tickets')
      .values({
        ticket_type_id: type.id,
        event_id: event.id,
        user_id: userId,
        status: ticket,
        checked_in_at: ticket === 'checked_in' ? end : null,
        cancelled_at: ticket === 'cancelled' ? start : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { eventId: event.id, ticketId: row.id };
  }

  it('keeps out someone with too many no-shows at this club, until the ban ends', async () => {
    const owner = await createUser(db);
    const regular = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const turnedOn = await patchClub(owner.token, orgId, { noShowRule: { limit: 2, banDays: 14 } });
    expect(turnedOn.json().noShowRule).toEqual({ limit: 2, banDays: 14 });

    await pastEvent(orgId, owner.id, regular.id, 20, 'active');
    // Used and cancelled tickets, and no-shows over 90 days old, don't count.
    await pastEvent(orgId, owner.id, regular.id, 15, 'checked_in');
    await pastEvent(orgId, owner.id, regular.id, 12, 'cancelled');
    await pastEvent(orgId, owner.id, regular.id, 120, 'active');
    expect((await claim(regular.token, eventId, ticketTypeIds[0] as string)).statusCode).toBe(201);

    const skipper = await createUser(db);
    await pastEvent(orgId, owner.id, skipper.id, 30, 'active');
    await pastEvent(orgId, owner.id, skipper.id, 5, 'active');
    const banned = await claim(skipper.token, eventId, ticketTypeIds[0] as string);
    expect(banned.statusCode).toBe(403);
    expect(banned.json().code).toBe('NO_SHOW_LIMIT');
    // 14 days from the latest no-show, which ended 5 days ago.
    expect(Date.parse(banned.json().until)).toBeCloseTo(Date.now() + 9 * DAY, -5);

    // Another club's events are none of this club's business.
    const otherOwner = await createUser(db);
    const other = await createPublishedEvent(app, otherOwner);
    expect((await claim(skipper.token, other.eventId, other.ticketTypeIds[0] as string)).statusCode).toBe(201);
  });

  it('lifts once the ban has run its course, and is off unless the club turns it on', async () => {
    const owner = await createUser(db);
    const skipper = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    await pastEvent(orgId, owner.id, skipper.id, 40, 'active');
    await pastEvent(orgId, owner.id, skipper.id, 30, 'active');
    // Rule off: two no-shows change nothing.
    expect((await claim(skipper.token, eventId, ticketTypeIds[0] as string)).statusCode).toBe(201);

    await patchClub(owner.token, orgId, { noShowRule: { limit: 2, banDays: 7 } });
    const sameClub = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/events`,
      headers: bearer(owner.token),
      payload: {
        title: 'Next one',
        startsAt: new Date(Date.now() + 3 * DAY).toISOString(),
        endsAt: new Date(Date.now() + 3 * DAY + 7_200_000).toISOString(),
      },
    });
    const nextId = sameClub.json().id;
    const type = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/events/${nextId}/ticket-types`,
      headers: bearer(owner.token),
      payload: { name: 'Standart', capacity: 10 },
    });
    await app.inject({ method: 'POST', url: `/orgs/${orgId}/events/${nextId}/publish`, headers: bearer(owner.token) });
    // Latest no-show ended 30 days ago and the ban is 7 days: over.
    expect((await claim(skipper.token, nextId, type.json().id)).statusCode).toBe(201);

    const off = await patchClub(owner.token, orgId, { noShowRule: null });
    expect(off.json().noShowRule).toBeNull();
    expect((await patchClub(owner.token, orgId, { noShowRule: { limit: 9, banDays: 14 } })).statusCode).toBe(400);
  });

  it('lets organizers excuse a no-show, which then stops counting', async () => {
    const owner = await createUser(db);
    const scanner = await createUser(db);
    const skipper = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: bearer(owner.token),
      payload: { email: scanner.email, role: 'scanner' },
    });
    await patchClub(owner.token, orgId, { noShowRule: { limit: 2, banDays: 30 } });
    const first = await pastEvent(orgId, owner.id, skipper.id, 10, 'active');
    await pastEvent(orgId, owner.id, skipper.id, 3, 'active');
    expect((await claim(skipper.token, eventId, ticketTypeIds[0] as string)).json().code).toBe('NO_SHOW_LIMIT');

    const excuse = (token: string, ticketId: string, onEvent: string, excused: boolean) =>
      app.inject({
        method: 'POST',
        url: `/orgs/${orgId}/events/${onEvent}/tickets/${ticketId}/excuse`,
        headers: bearer(token),
        payload: { excused },
      });
    expect((await excuse(scanner.token, first.ticketId, first.eventId, true)).statusCode).toBe(403);
    expect((await excuse(owner.token, first.ticketId, first.eventId, true)).statusCode).toBe(204);

    const attendees = await app.inject({
      method: 'GET',
      url: `/orgs/${orgId}/events/${first.eventId}/attendees`,
      headers: bearer(owner.token),
    });
    expect(attendees.json()).toEqual([expect.objectContaining({ ticketId: first.ticketId, excused: true })]);
    expect((await claim(skipper.token, eventId, ticketTypeIds[0] as string)).statusCode).toBe(201);

    // Only a ticket left unused at an event that is over is a no-show.
    const upcoming = await claim((await createUser(db)).token, eventId, ticketTypeIds[0] as string);
    const notYet = await excuse(owner.token, upcoming.json().id, eventId, true);
    expect(notYet.json().code).toBe('NOT_A_NO_SHOW');
  });
});
