import { randomUUID } from 'node:crypto';
import { QR_STEP_SECONDS } from '@etkin/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import {
  bearer,
  createPublishedEvent,
  createTestDatabase,
  createTicketHolder,
  createUser,
  testConfig,
} from './helpers.js';

let db: Database;
let app: App;
type User = Awaited<ReturnType<typeof createUser>>;
let owner: User;
let organizer: User;
let scanner: User;

const MINUTE = 60_000;
const STEP_MS = QR_STEP_SECONDS * 1000;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  owner = await createUser(db);
  organizer = await createUser(db);
  scanner = await createUser(db);
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

/** A published event in a new club whose door is open now, staffed by our organizer and scanner. */
async function openDoor(options: { startsInMs?: number; event?: Record<string, unknown> } = {}) {
  const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(
    app,
    owner,
    [{ name: 'Standart', capacity: 100 }],
    { startsInMs: 30 * MINUTE, ...options },
  );
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
  const ticketTypeId = ticketTypeIds[0] ?? '';
  return { orgId, eventId, ticketTypeId, holder: () => createTicketHolder(app, db, eventId, ticketTypeId) };
}

type Door = Awaited<ReturnType<typeof openDoor>>;

const scan = (door: Door, qr: string, { as = scanner, key }: { as?: User; key?: string } = {}) =>
  app.inject({
    method: 'POST',
    url: `/orgs/${door.orgId}/events/${door.eventId}/check-ins`,
    headers: { ...bearer(as.token), ...(key && { 'idempotency-key': key }) },
    payload: { qr, gate: 'Ana kapı' },
  });

const lifetimePoints = async (userId: string, orgId: string) =>
  (
    await db
      .selectFrom('point_balances')
      .select('lifetime_earned')
      .where('user_id', '=', userId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst()
  )?.lifetime_earned ?? 0;

describe('admitting', () => {
  it('admits a valid code, marks the ticket used and awards the club point', async () => {
    const door = await openDoor();
    const holder = await door.holder();

    const res = await scan(door, holder.qrAt());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      result: 'accepted',
      replayed: false,
      attendee: { name: expect.stringMatching(/^Member \d+$/) },
      ticketType: 'Standart',
      checkIn: { gate: 'Ana kapı', method: 'qr', scannedBy: expect.stringMatching(/^Member \d+$/) },
      pointsAwarded: 1,
      checkedInCount: 1,
    });

    const ticket = await app.inject({
      method: 'GET',
      url: `/tickets/${holder.ticketId}`,
      headers: bearer(holder.user.token),
    });
    expect(ticket.json()).toMatchObject({ status: 'checked_in', checkedInAt: expect.any(String) });
    expect(await lifetimePoints(holder.user.id, door.orgId)).toBe(1);

    const outbox = await db.selectFrom('outbox').select(['topic', 'payload']).execute();
    expect(outbox).toContainEqual({
      topic: 'checkin.accepted',
      payload: expect.objectContaining({ ticketId: holder.ticketId, points: 1 }),
    });
  });

  it('answers a second scan with the original check-in and no extra points', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const first = (await scan(door, holder.qrAt())).json();

    const second = (await scan(door, holder.qrAt())).json();
    expect(second).toMatchObject({
      result: 'duplicate',
      checkIn: { id: first.checkIn.id, gate: 'Ana kapı' },
      attendee: first.attendee,
      pointsAwarded: 0,
      checkedInCount: 1,
    });
    expect(await lifetimePoints(holder.user.id, door.orgId)).toBe(1);
  });

  it('returns the original success when the scanner retries the same request', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const key = randomUUID();
    const code = holder.qrAt();

    const first = (await scan(door, code, { key })).json();
    const retry = (await scan(door, code, { key })).json();
    expect(retry).toMatchObject({ result: 'accepted', replayed: true, checkIn: { id: first.checkIn.id } });

    const rescan = (await scan(door, code, { key: randomUUID() })).json();
    expect(rescan.result).toBe('duplicate');
  });

  it('lets organizers admit a ticket by id when the phone is dead', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const manual = (as: User) =>
      app.inject({
        method: 'POST',
        url: `/orgs/${door.orgId}/events/${door.eventId}/check-ins/manual`,
        headers: bearer(as.token),
        payload: { ticketId: holder.ticketId },
      });

    expect((await manual(scanner)).statusCode).toBe(403);
    const res = await manual(organizer);
    expect(res.json()).toMatchObject({ result: 'accepted', checkIn: { method: 'manual' } });
  });

  it('awards whatever the event is worth, including nothing', async () => {
    for (const points of [0, 5]) {
      const door = await openDoor({ event: { checkinPoints: points } });
      const holder = await door.holder();
      expect((await scan(door, holder.qrAt())).json().pointsAwarded).toBe(points);
      expect(await lifetimePoints(holder.user.id, door.orgId)).toBe(points);
    }
  });
});

describe('rejecting', () => {
  it('rejects a screenshot once it has expired', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const res = (await scan(door, holder.qrAt(Date.now() - 2 * STEP_MS))).json();
    expect(res).toMatchObject({ result: 'expired_token', attendee: null, checkIn: null });
  });

  it('rejects forged and foreign codes', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const code = holder.qrAt();
    const tampered = code.slice(0, -2) + (code.endsWith('A') ? 'BB' : 'AA');

    for (const qr of ['hello', 'https://instagram.com/club', tampered]) {
      expect((await scan(door, qr)).json().result).toBe('invalid_token');
    }
  });

  it('rejects codes from a phone the ticket has moved away from', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const oldPhoneCode = holder.qrAt();
    await app.inject({
      method: 'POST',
      url: `/tickets/${holder.ticketId}/qr-key`,
      headers: bearer(holder.user.token),
      payload: { deviceId: 'phone-2' },
    });

    expect((await scan(door, oldPhoneCode)).json().result).toBe('invalid_token');
  });

  it('flags a ticket for another event', async () => {
    const door = await openDoor();
    const elsewhere = await openDoor({ event: { title: 'Başka Etkinlik' } });
    const holder = await elsewhere.holder();

    const res = (await scan(door, holder.qrAt())).json();
    expect(res).toMatchObject({ result: 'wrong_event', otherEvent: { title: 'Başka Etkinlik' } });
  });

  it('refuses a ticket cancelled after its code was shown', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const code = holder.qrAt();
    await app.inject({
      method: 'POST',
      url: `/tickets/${holder.ticketId}/cancel`,
      headers: bearer(holder.user.token),
    });

    expect((await scan(door, code)).json()).toMatchObject({
      result: 'ticket_cancelled',
      attendee: { name: expect.any(String) },
    });
  });

  it('keeps the door shut outside the check-in window', async () => {
    const door = await openDoor({ startsInMs: 3 * 24 * 60 * MINUTE });
    const holder = await door.holder();
    const res = (await scan(door, holder.qrAt())).json();
    expect(res.result).toBe('outside_window');
    expect(res.message).toMatch(/^Check-in is open from /);
  });

  it('logs every scan, accepted or not', async () => {
    const door = await openDoor();
    const holder = await door.holder();
    await scan(door, 'hello');
    await scan(door, holder.qrAt());
    await scan(door, holder.qrAt());

    const log = await db
      .selectFrom('scan_attempts')
      .select(['result', 'ticket_id', 'gate'])
      .where('event_id', '=', door.eventId)
      .orderBy('id')
      .execute();
    expect(log).toEqual([
      { result: 'invalid_token', ticket_id: null, gate: 'Ana kapı' },
      { result: 'accepted', ticket_id: holder.ticketId, gate: 'Ana kapı' },
      { result: 'duplicate', ticket_id: holder.ticketId, gate: 'Ana kapı' },
    ]);
  });
});

describe('who may scan', () => {
  it("is limited to the club's team", async () => {
    const door = await openDoor();
    const holder = await door.holder();
    const otherClub = await openDoor();
    const otherClubScanner = await createUser(db);
    await app.inject({
      method: 'POST',
      url: `/orgs/${otherClub.orgId}/members`,
      headers: bearer(owner.token),
      payload: { email: otherClubScanner.email, role: 'scanner' },
    });

    for (const user of [holder.user, otherClubScanner]) {
      expect((await scan(door, holder.qrAt(), { as: user })).statusCode).toBe(403);
    }
  });

  it("can't scan another club's event through its own club", async () => {
    const door = await openDoor();
    const other = await openDoor();
    const holder = await door.holder();
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${other.orgId}/events/${door.eventId}/check-ins`,
      headers: bearer(scanner.token),
      payload: { qr: holder.qrAt() },
    });
    expect(res.statusCode).toBe(404);
  });
});
