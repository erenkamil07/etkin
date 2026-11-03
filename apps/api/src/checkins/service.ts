import { deriveTicketKey, parseQrPayload, verifyQrPayload } from '@etkin/shared';
import { sql } from 'kysely';
import type { CheckinMethod, ScanResult } from '../db/schema.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { iso } from '../schemas.js';

export interface ScanInput {
  orgId: string;
  eventId: string;
  scannerId: string;
  gate?: string | undefined;
  deviceId?: string | undefined;
  /** Same key on a retried request returns the original result instead of "duplicate". */
  idempotencyKey?: string | undefined;
}

type Credential = { method: 'qr'; qr: string } | { method: 'manual'; ticketId: string };

interface Attendee {
  name: string;
  avatarUrl: string | null;
  studentNumber: string | null;
}

/** Every scan gets a verdict; rejections are normal at a door, not client errors. */
export interface ScanVerdict {
  result: ScanResult;
  message: string;
  replayed: boolean;
  attendee: Attendee | null;
  ticketType: string | null;
  checkIn: { id: string; at: string; gate: string | null; method: CheckinMethod; scannedBy: string } | null;
  pointsAwarded: number;
  /** The ticket's own event, when it isn't the one being scanned. */
  otherEvent: { id: string; title: string } | null;
  checkedInCount: number;
}

const MESSAGES: Record<ScanResult, string> = {
  accepted: 'Checked in',
  duplicate: 'This ticket was already checked in',
  invalid_token: 'Not a valid ticket code',
  expired_token: 'Code expired; ask the attendee to reopen their ticket',
  wrong_event: 'This ticket is for a different event',
  ticket_cancelled: 'This ticket was cancelled',
  outside_window: 'Check-in is not open right now',
};

async function loadEvent(db: Database, orgId: string, eventId: string) {
  const event = await db
    .selectFrom('events')
    .select(['id', 'organization_id', 'status', 'checkin_opens_at', 'checkin_closes_at', 'checkin_points'])
    .where('id', '=', eventId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');
  return event;
}

function loadTicket(db: Database, ticketId: string) {
  return db
    .selectFrom('tickets as t')
    .innerJoin('users as u', 'u.id', 't.user_id')
    .innerJoin('ticket_types as tt', 'tt.id', 't.ticket_type_id')
    .innerJoin('events as e', 'e.id', 't.event_id')
    .select([
      't.id',
      't.event_id',
      't.user_id',
      't.status',
      't.qr_key_version',
      'tt.name as ticket_type',
      'e.title as event_title',
      'u.full_name',
      'u.avatar_url',
      'u.student_number',
    ])
    .where('t.id', '=', ticketId)
    .executeTakeFirst();
}

type ScannedTicket = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;

const attendeeOf = (ticket: ScannedTicket): Attendee => ({
  name: ticket.full_name,
  avatarUrl: ticket.avatar_url,
  studentNumber: ticket.student_number,
});

async function checkedInCount(db: Database, eventId: string) {
  const { count } = await db
    .selectFrom('check_ins')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('event_id', '=', eventId)
    .executeTakeFirstOrThrow();
  return count;
}

/** The recorded check-in of a ticket, with the scanner's name, for accepted replays and duplicates. */
async function existingCheckIn(db: Database, where: { ticketId: string } | { idempotencyKey: string }) {
  let query = db
    .selectFrom('check_ins as c')
    .innerJoin('users as s', 's.id', 'c.scanned_by')
    .select(['c.id', 'c.ticket_id', 'c.created_at', 'c.gate', 'c.method', 's.full_name as scanned_by']);
  query =
    'ticketId' in where
      ? query.where('c.ticket_id', '=', where.ticketId)
      : query.where('c.idempotency_key', '=', where.idempotencyKey);
  const row = await query.executeTakeFirst();
  return (
    row && {
      ...row,
      checkIn: { id: row.id, at: iso(row.created_at), gate: row.gate, method: row.method, scannedBy: row.scanned_by },
    }
  );
}

/**
 * Admits a ticket at the door. Every outcome is logged to scan_attempts.
 *
 * Exactly-once admission does not depend on the pre-checks below (two gates
 * can pass them at the same moment): it rests on the conditional
 * `UPDATE tickets ... WHERE status = 'active'` inside the transaction, with
 * UNIQUE (check_ins.ticket_id) as the backstop.
 */
export async function scanTicket(
  db: Database,
  masterKey: Uint8Array,
  input: ScanInput,
  credential: Credential,
): Promise<ScanVerdict> {
  const event = await loadEvent(db, input.orgId, input.eventId);

  const verdict = async (
    result: ScanResult,
    ticket: ScannedTicket | null,
    extra: Partial<ScanVerdict> = {},
    ticketIdForLog: string | null = ticket?.id ?? null,
  ): Promise<ScanVerdict> => {
    await db
      .insertInto('scan_attempts')
      .values({
        event_id: event.id,
        ticket_id: ticketIdForLog,
        scanned_by: input.scannerId,
        result,
        gate: input.gate ?? null,
        scanner_device_id: input.deviceId ?? null,
      })
      .execute();
    return {
      result,
      message: MESSAGES[result],
      replayed: false,
      attendee: ticket && (result === 'duplicate' || result === 'ticket_cancelled') ? attendeeOf(ticket) : null,
      ticketType: null,
      checkIn: null,
      pointsAwarded: 0,
      otherEvent: null,
      checkedInCount: await checkedInCount(db, event.id),
      ...extra,
    };
  };

  const duplicate = async (ticket: ScannedTicket) => {
    const original = await existingCheckIn(db, { ticketId: ticket.id });
    return verdict('duplicate', ticket, { checkIn: original?.checkIn ?? null, ticketType: ticket.ticket_type });
  };

  if (input.idempotencyKey) {
    const prior = await existingCheckIn(db, { idempotencyKey: input.idempotencyKey });
    const ticket = prior && (await loadTicket(db, prior.ticket_id));
    if (prior && ticket) {
      return {
        result: 'accepted',
        message: MESSAGES.accepted,
        replayed: true,
        attendee: attendeeOf(ticket),
        ticketType: ticket.ticket_type,
        checkIn: prior.checkIn,
        pointsAwarded: event.checkin_points,
        otherEvent: null,
        checkedInCount: await checkedInCount(db, event.id),
      };
    }
  }

  let ticket: ScannedTicket | undefined;
  if (credential.method === 'qr') {
    const parsed = parseQrPayload(credential.qr);
    if (!parsed) return verdict('invalid_token', null);
    ticket = await loadTicket(db, parsed.ticketId);
    if (!ticket) return verdict('invalid_token', null, {}, null);
    const key = deriveTicketKey(masterKey, ticket.id, ticket.qr_key_version);
    const check = verifyQrPayload(parsed, key, Date.now());
    if (check !== 'valid') return verdict(check === 'expired' ? 'expired_token' : 'invalid_token', null, {}, ticket.id);
  } else {
    ticket = await loadTicket(db, credential.ticketId);
    if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
  }

  if (ticket.event_id !== event.id) {
    return verdict('wrong_event', ticket, { otherEvent: { id: ticket.event_id, title: ticket.event_title } });
  }
  if (ticket.status === 'cancelled') return verdict('ticket_cancelled', ticket);
  if (ticket.status === 'checked_in') return duplicate(ticket);

  const now = new Date();
  if (event.status !== 'published' || now < event.checkin_opens_at || now > event.checkin_closes_at) {
    return verdict('outside_window', null, {
      message: `Check-in is open from ${iso(event.checkin_opens_at)} to ${iso(event.checkin_closes_at)}`,
    });
  }

  const admitted = ticket;
  const checkIn = await db.transaction().execute(async (trx) => {
    const won = await trx
      .updateTable('tickets')
      .set({ status: 'checked_in', checked_in_at: now })
      .where('id', '=', admitted.id)
      .where('status', '=', 'active')
      .returning('id')
      .executeTakeFirst();
    if (!won) return null;

    const row = await trx
      .insertInto('check_ins')
      .values({
        ticket_id: admitted.id,
        event_id: event.id,
        user_id: admitted.user_id,
        scanned_by: input.scannerId,
        method: credential.method,
        gate: input.gate ?? null,
        scanner_device_id: input.deviceId ?? null,
        idempotency_key: input.idempotencyKey ?? null,
      })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();

    if (event.checkin_points > 0) {
      await trx
        .insertInto('point_ledger')
        .values({
          user_id: admitted.user_id,
          organization_id: event.organization_id,
          delta: event.checkin_points,
          reason: 'checkin',
          check_in_id: row.id,
        })
        .execute();
    }
    // Badges, push notifications and live dashboards react to this outside the request.
    await trx
      .insertInto('outbox')
      .values({
        topic: 'checkin.accepted',
        payload: JSON.stringify({
          checkInId: row.id,
          ticketId: admitted.id,
          eventId: event.id,
          userId: admitted.user_id,
          organizationId: event.organization_id,
          points: event.checkin_points,
        }),
      })
      .execute();
    return row;
  });

  // Lost the race to another gate (or the ticket was cancelled in between).
  if (!checkIn) {
    const latest = await loadTicket(db, admitted.id);
    if (latest?.status === 'checked_in') return duplicate(latest);
    return verdict('ticket_cancelled', latest ?? admitted);
  }

  const scanner = await db
    .selectFrom('users')
    .select('full_name')
    .where('id', '=', input.scannerId)
    .executeTakeFirstOrThrow();
  return verdict('accepted', admitted, {
    attendee: attendeeOf(admitted),
    ticketType: admitted.ticket_type,
    checkIn: {
      id: checkIn.id,
      at: iso(checkIn.created_at),
      gate: input.gate ?? null,
      method: credential.method,
      scannedBy: scanner.full_name,
    },
    pointsAwarded: event.checkin_points,
  });
}
