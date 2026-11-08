import { sql } from 'kysely';
import type { ScanResult, TicketStatus } from '../db/schema.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { iso, isoOrNull } from '../schemas.js';

const ARRIVAL_BUCKET = '10 minutes';
const SCAN_RESULTS: ScanResult[] = [
  'accepted',
  'duplicate',
  'invalid_token',
  'expired_token',
  'wrong_event',
  'ticket_cancelled',
  'outside_window',
];

async function eventInOrg(db: Database, orgId: string, eventId: string) {
  const event = await db
    .selectFrom('events')
    .select(['id', 'ends_at', 'checkin_opens_at'])
    .where('id', '=', eventId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');
  return event;
}

/** Everything an organizer looks at during and after an event. */
export async function getEventStats(db: Database, orgId: string, eventId: string) {
  const event = await eventInOrg(db, orgId, eventId);

  const tickets = await db
    .selectFrom('tickets')
    .select([
      sql<number>`count(*) filter (where status <> 'cancelled')::int`.as('issued'),
      sql<number>`count(*) filter (where status = 'checked_in')::int`.as('checkedIn'),
      sql<number>`count(*) filter (where status = 'cancelled')::int`.as('cancelled'),
      sql<number>`count(*) filter (where status = 'active')::int`.as('waiting'),
    ])
    .where('event_id', '=', eventId)
    .executeTakeFirstOrThrow();

  const byTicketType = await db
    .selectFrom('ticket_types as tt')
    .leftJoin('tickets as t', 't.ticket_type_id', 'tt.id')
    .select([
      'tt.id',
      'tt.name',
      'tt.capacity',
      sql<number>`count(t.id) filter (where t.status <> 'cancelled')::int`.as('issued'),
      sql<number>`count(t.id) filter (where t.status = 'checked_in')::int`.as('checkedIn'),
    ])
    .where('tt.event_id', '=', eventId)
    .groupBy(['tt.id', 'tt.name', 'tt.capacity', 'tt.created_at'])
    .orderBy('tt.created_at')
    .execute();

  // Arrival curve in 10-minute buckets aligned to when the doors opened.
  const arrivals = await db
    .selectFrom('check_ins as c')
    .select([
      sql<Date>`date_bin(${ARRIVAL_BUCKET}::interval, c.created_at, ${event.checkin_opens_at}::timestamptz)`.as(
        'bucket',
      ),
      sql<number>`count(*)::int`.as('count'),
    ])
    .where('c.event_id', '=', eventId)
    .groupBy(sql`1`)
    .orderBy(sql`1`)
    .execute();

  const gates = await db
    .selectFrom('check_ins')
    .select([sql<string | null>`gate`.as('gate'), sql<number>`count(*)::int`.as('count')])
    .where('event_id', '=', eventId)
    .groupBy('gate')
    .orderBy(sql`2`, 'desc')
    .execute();

  const scanRows = await db
    .selectFrom('scan_attempts')
    .select(['result', sql<number>`count(*)::int`.as('count')])
    .where('event_id', '=', eventId)
    .groupBy('result')
    .execute();
  const scans = Object.fromEntries(SCAN_RESULTS.map((result) => [result, 0])) as Record<ScanResult, number>;
  for (const row of scanRows) scans[row.result] = row.count;

  const ended = event.ends_at <= new Date();
  return {
    tickets: {
      ...tickets,
      noShows: ended ? tickets.waiting : null,
      attendanceRate: tickets.issued > 0 ? Math.round((tickets.checkedIn / tickets.issued) * 1000) / 1000 : null,
    },
    byTicketType,
    arrivals: arrivals.map((row) => ({ from: iso(new Date(row.bucket)), count: row.count })),
    gates: gates.map((row) => ({ gate: row.gate, count: row.count })),
    scans,
  };
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** For the door: find a holder by name or student number, e.g. to admit them without their phone. */
export async function searchAttendees(
  db: Database,
  orgId: string,
  eventId: string,
  { q, status }: { q?: string | undefined; status?: TicketStatus | undefined },
) {
  await eventInOrg(db, orgId, eventId);
  let query = db
    .selectFrom('tickets as t')
    .innerJoin('users as u', 'u.id', 't.user_id')
    .innerJoin('ticket_types as tt', 'tt.id', 't.ticket_type_id')
    .select([
      't.id',
      't.status',
      't.checked_in_at',
      't.excused_at',
      'tt.name as ticket_type',
      'u.full_name',
      'u.student_number',
      'u.avatar_url',
    ])
    .where('t.event_id', '=', eventId)
    .orderBy('u.full_name')
    .limit(200);
  if (status) query = query.where('t.status', '=', status);
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    query = query.where((eb) => eb.or([eb('u.full_name', 'ilike', pattern), eb('u.student_number', 'ilike', pattern)]));
  }

  const rows = await query.execute();
  return rows.map((row) => ({
    ticketId: row.id,
    status: row.status,
    checkedInAt: isoOrNull(row.checked_in_at),
    excused: row.excused_at !== null,
    ticketType: row.ticket_type,
    name: row.full_name,
    studentNumber: row.student_number,
    avatarUrl: row.avatar_url,
  }));
}

/**
 * Marks a no-show as excused ("Mazeretli"), or takes that back, so it does or
 * doesn't count towards the club's no-show rule. Only a ticket that was still
 * live when its event ended is a no-show.
 */
export async function setNoShowExcused(
  db: Database,
  orgId: string,
  eventId: string,
  ticketId: string,
  excused: boolean,
) {
  const event = await eventInOrg(db, orgId, eventId);
  const ticket = await db
    .selectFrom('tickets')
    .select('status')
    .where('id', '=', ticketId)
    .where('event_id', '=', eventId)
    .executeTakeFirst();
  if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
  if (ticket.status !== 'active' || event.ends_at > new Date()) {
    throw new AppError(
      409,
      'NOT_A_NO_SHOW',
      'Only a ticket that was never used at an event that has ended can be excused',
    );
  }
  await db
    .updateTable('tickets')
    .set({ excused_at: excused ? new Date() : null })
    .where('id', '=', ticketId)
    .execute();
}
