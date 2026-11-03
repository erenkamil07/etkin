// Seeds a throwaway *_load database for the k6 load tests and writes the
// fixture the k6 scripts read (access tokens, ticket keys). Run it through
// loadtest/run.mjs, which passes the matching secrets to the API containers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deriveTicketKey, encodeTicketKey } from '@etkin/shared';
import { createAccessTokens } from '../src/auth/tokens.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { recreateDatabase } from './fresh-database.js';

const ATTENDEES = Number(process.env.LOAD_ATTENDEES ?? 5200);
const DROP_STUDENTS = Number(process.env.LOAD_DROP_STUDENTS ?? 1000);
const DROP_CAPACITY = Number(process.env.LOAD_DROP_CAPACITY ?? 300);
const GATES = ['Ana kapı', 'Yan kapı', 'Otopark', 'Fuaye'];
const FIXTURE = new URL('../../../loadtest/.fixtures/fixture.json', import.meta.url);
const BATCH = 1000;

const config = loadConfig();
await recreateDatabase(config.DATABASE_URL);
const db = createDatabase(config.DATABASE_URL, 5);
const tokens = createAccessTokens(config.JWT_ACCESS_SECRET, 2 * 3600); // outlives the test run
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function insertUsers(prefix: string, count: number) {
  const ids: string[] = [];
  for (let start = 0; start < count; start += BATCH) {
    const rows = await db
      .insertInto('users')
      .values(
        Array.from({ length: Math.min(BATCH, count - start) }, (_, i) => ({
          email: `${prefix}${start + i}@load.test`,
          full_name: `${prefix} ${start + i}`,
        })),
      )
      .returning('id')
      .execute();
    ids.push(...rows.map((row) => row.id));
  }
  return ids;
}

const [ownerId = '', ...scannerIds] = await insertUsers('staff-', 1 + GATES.length);
const { id: orgId } = await db
  .insertInto('organizations')
  .values({ slug: 'load-test-club', name: 'Load Test Club' })
  .returning('id')
  .executeTakeFirstOrThrow();
await db
  .insertInto('organization_members')
  .values([
    { organization_id: orgId, user_id: ownerId, role: 'owner' },
    ...scannerIds.map((id) => ({ organization_id: orgId, user_id: id, role: 'scanner' as const })),
  ])
  .execute();

// Door rush: an event whose check-in window is open, every attendee holding a bound ticket.
const { id: eventId } = await db
  .insertInto('events')
  .values({
    organization_id: orgId,
    title: 'Load Test Night',
    status: 'published',
    published_at: new Date(),
    starts_at: minutesFromNow(30),
    ends_at: minutesFromNow(240),
    checkin_opens_at: minutesFromNow(-30),
    checkin_closes_at: minutesFromNow(240),
    created_by: ownerId,
  })
  .returning('id')
  .executeTakeFirstOrThrow();
const { id: ticketTypeId } = await db
  .insertInto('ticket_types')
  .values({
    event_id: eventId,
    name: 'Standart',
    capacity: ATTENDEES,
    issued_count: ATTENDEES,
    sales_starts_at: minutesFromNow(-24 * 60),
    sales_ends_at: minutesFromNow(20),
  })
  .returning('id')
  .executeTakeFirstOrThrow();

const attendeeIds = await insertUsers('attendee-', ATTENDEES);
const ticketIds: string[] = [];
for (let start = 0; start < attendeeIds.length; start += BATCH) {
  const rows = await db
    .insertInto('tickets')
    .values(
      attendeeIds.slice(start, start + BATCH).map((userId) => ({
        ticket_type_id: ticketTypeId,
        event_id: eventId,
        user_id: userId,
        bound_device_id: 'loadtest-phone',
      })),
    )
    .returning('id')
    .execute();
  ticketIds.push(...rows.map((row) => row.id));
}

// Ticket drop: sales are open now and many more students than seats.
const { id: dropEventId } = await db
  .insertInto('events')
  .values({
    organization_id: orgId,
    title: 'Workshop Drop',
    status: 'published',
    published_at: new Date(),
    starts_at: minutesFromNow(24 * 60),
    ends_at: minutesFromNow(24 * 60 + 120),
    checkin_opens_at: minutesFromNow(24 * 60 - 60),
    checkin_closes_at: minutesFromNow(24 * 60 + 120),
    created_by: ownerId,
  })
  .returning('id')
  .executeTakeFirstOrThrow();
const { id: dropTicketTypeId } = await db
  .insertInto('ticket_types')
  .values({
    event_id: dropEventId,
    name: 'Workshop',
    capacity: DROP_CAPACITY,
    sales_starts_at: minutesFromNow(-1),
    sales_ends_at: minutesFromNow(24 * 60),
  })
  .returning('id')
  .executeTakeFirstOrThrow();
const studentIds = await insertUsers('student-', DROP_STUDENTS);

const fixture = {
  orgId,
  eventId,
  gates: await Promise.all(
    GATES.map(async (name, i) => ({
      name,
      token: await tokens.sign({ id: scannerIds[i] ?? '', platformRole: 'user' }),
    })),
  ),
  attendees: ticketIds.map((ticketId) => ({
    ticketId,
    key: encodeTicketKey(deriveTicketKey(config.QR_MASTER_KEY, ticketId, 1)),
  })),
  drop: {
    eventId: dropEventId,
    ticketTypeId: dropTicketTypeId,
    capacity: DROP_CAPACITY,
    studentTokens: await Promise.all(studentIds.map((id) => tokens.sign({ id, platformRole: 'user' }))),
  },
};
mkdirSync(new URL('.', FIXTURE), { recursive: true });
writeFileSync(FIXTURE, JSON.stringify(fixture));
console.log(
  `seeded ${ATTENDEES} attendees, ${GATES.length} gates, ${DROP_STUDENTS} students for ${DROP_CAPACITY} drop seats`,
);
await db.destroy();
