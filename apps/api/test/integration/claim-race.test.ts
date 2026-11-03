import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import type { Database } from '../../src/db.js';
import { bearer, createPublishedEvent, createUser, testConfig } from '../helpers.js';
import { createIntegrationDatabase } from './database.js';

let db: Database;
let app: App;
type User = Awaited<ReturnType<typeof createUser>>;
let owner: User;

beforeAll(async () => {
  db = await createIntegrationDatabase();
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

const createUsers = (count: number) => Promise.all(Array.from({ length: count }, () => createUser(db)));

function countBy<T>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(counts);
}

async function ticketCounts(ticketTypeId: string) {
  const row = await db
    .selectFrom('ticket_types')
    .select([
      'issued_count',
      sql<number>`(select count(*)::int from tickets t where t.ticket_type_id = ticket_types.id and t.status <> 'cancelled')`.as(
        'live',
      ),
    ])
    .where('id', '=', ticketTypeId)
    .executeTakeFirstOrThrow();
  return { issued: row.issued_count, live: row.live };
}

describe('concurrent claims on real PostgreSQL', () => {
  it('sells exactly the capacity when 50 students race for 10 seats', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [{ name: 'Workshop', capacity: 10 }]);
    const [seats = ''] = ticketTypeIds;
    const students = await createUsers(50);

    const responses = await Promise.all(students.map((student) => claim(student, eventId, seats)));

    expect(countBy(responses.map((res) => res.statusCode))).toEqual({ 201: 10, 409: 40 });
    const refusals = responses.filter((res) => res.statusCode === 409).map((res) => res.json().code);
    expect(new Set(refusals)).toEqual(new Set(['SOLD_OUT']));
    expect(await ticketCounts(seats)).toEqual({ issued: 10, live: 10 });
  });

  it('gives one ticket to a student who taps "claim" ten times at once', async () => {
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [{ name: 'Standart', capacity: 100 }]);
    const [standard = ''] = ticketTypeIds;
    const [student] = await createUsers(1);
    if (!student) throw new Error('no user');

    const responses = await Promise.all(Array.from({ length: 10 }, () => claim(student, eventId, standard)));

    expect(countBy(responses.map((res) => res.statusCode))).toEqual({ 201: 1, 200: 9 });
    expect(new Set(responses.map((res) => res.json().id)).size).toBe(1);
    expect(await ticketCounts(standard)).toEqual({ issued: 1, live: 1 });
  });

  it('lets no ticket slip through while the organizer cancels the event', async () => {
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner, [
      { name: 'Standart', capacity: 100 },
    ]);
    const [standard = ''] = ticketTypeIds;
    const students = await createUsers(30);

    await Promise.all([
      ...students.map((student) => claim(student, eventId, standard)),
      app.inject({ method: 'POST', url: `/orgs/${orgId}/events/${eventId}/cancel`, headers: bearer(owner.token) }),
    ]);

    const { active } = await db
      .selectFrom('tickets')
      .select(sql<number>`count(*) filter (where status = 'active')::int`.as('active'))
      .where('event_id', '=', eventId)
      .executeTakeFirstOrThrow();
    expect(active).toBe(0);
  });
});
