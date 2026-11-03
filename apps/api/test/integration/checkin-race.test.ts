import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import type { Database } from '../../src/db.js';
import { bearer, createPublishedEvent, createTicketHolder, createUser, testConfig } from '../helpers.js';
import { createIntegrationDatabase } from './database.js';

let db: Database;
let app: App;
type User = Awaited<ReturnType<typeof createUser>>;
let owner: User;
let scanner: User;

beforeAll(async () => {
  db = await createIntegrationDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  owner = await createUser(db);
  scanner = await createUser(db);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

async function openDoor() {
  const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(
    app,
    owner,
    [{ name: 'Standart', capacity: 200 }],
    { startsInMs: 30 * 60_000 },
  );
  await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/members`,
    headers: bearer(owner.token),
    payload: { email: scanner.email, role: 'scanner' },
  });
  return { orgId, eventId, ticketTypeId: ticketTypeIds[0] ?? '' };
}

const scan = (door: { orgId: string; eventId: string }, qr: string, gate: string) =>
  app.inject({
    method: 'POST',
    url: `/orgs/${door.orgId}/events/${door.eventId}/check-ins`,
    headers: bearer(scanner.token),
    payload: { qr, gate },
  });

function countBy<T>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(counts);
}

async function eventTotals(eventId: string) {
  return db
    .selectFrom('events as e')
    .select([
      sql<number>`(select count(*)::int from check_ins c where c.event_id = e.id)`.as('checkIns'),
      sql<number>`(select count(*)::int from point_ledger l join check_ins c on c.id = l.check_in_id where c.event_id = e.id)`.as(
        'pointEntries',
      ),
      sql<number>`(select count(*)::int from scan_attempts s where s.event_id = e.id)`.as('scansLogged'),
    ])
    .where('e.id', '=', eventId)
    .executeTakeFirstOrThrow();
}

describe('concurrent scans on real PostgreSQL', () => {
  it('admits a ticket scanned 50 times at once across 5 gates exactly once', async () => {
    const door = await openDoor();
    const holder = await createTicketHolder(app, db, door.eventId, door.ticketTypeId);
    const code = holder.qrAt();

    const responses = await Promise.all(Array.from({ length: 50 }, (_, i) => scan(door, code, `Kapı ${(i % 5) + 1}`)));

    expect(responses.every((res) => res.statusCode === 200)).toBe(true);
    const verdicts = responses.map((res) => res.json());
    expect(countBy(verdicts.map((v) => v.result))).toEqual({ accepted: 1, duplicate: 49 });

    // Every duplicate points at the one real check-in.
    const winner = verdicts.find((v) => v.result === 'accepted');
    expect(new Set(verdicts.map((v) => v.checkIn.id))).toEqual(new Set([winner.checkIn.id]));
    expect(await eventTotals(door.eventId)).toEqual({ checkIns: 1, pointEntries: 1, scansLogged: 50 });

    const balance = await db
      .selectFrom('point_balances')
      .select('lifetime_earned')
      .where('user_id', '=', holder.user.id)
      .executeTakeFirstOrThrow();
    expect(balance.lifetime_earned).toBe(1);
  });

  it('handles a busy door: 20 people, each scanned at two gates at the same time', async () => {
    const door = await openDoor();
    const holders = await Promise.all(
      Array.from({ length: 20 }, () => createTicketHolder(app, db, door.eventId, door.ticketTypeId)),
    );

    const responses = await Promise.all(
      holders.flatMap((holder) => [scan(door, holder.qrAt(), 'Kapı A'), scan(door, holder.qrAt(), 'Kapı B')]),
    );

    expect(countBy(responses.map((res) => res.json().result))).toEqual({ accepted: 20, duplicate: 20 });
    expect(await eventTotals(door.eventId)).toEqual({ checkIns: 20, pointEntries: 20, scansLogged: 40 });
  });
});
