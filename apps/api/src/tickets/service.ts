import { deriveTicketKey, encodeTicketKey, QR_STEP_SECONDS, QR_TOLERANCE_STEPS } from '@etkin/shared';
import type { AllocationMode, EventStatus, TicketStatus } from '../db/schema.js';
import { type Database, isUniqueViolation } from '../db.js';
import { AppError } from '../errors.js';
import { iso, isoOrNull } from '../schemas.js';

const TICKET_COLUMNS = [
  't.id',
  't.status',
  't.created_at',
  't.checked_in_at',
  't.cancelled_at',
  'tt.id as ticket_type_id',
  'tt.name as ticket_type_name',
  'e.id as event_id',
  'e.title as event_title',
  'e.starts_at',
  'e.ends_at',
  'e.location_name',
  'e.status as event_status',
  'o.id as org_id',
  'o.slug as org_slug',
  'o.name as org_name',
] as const;

interface TicketRow {
  id: string;
  status: TicketStatus;
  created_at: Date;
  checked_in_at: Date | null;
  cancelled_at: Date | null;
  ticket_type_id: string;
  ticket_type_name: string;
  event_id: string;
  event_title: string;
  starts_at: Date;
  ends_at: Date;
  location_name: string | null;
  event_status: EventStatus;
  org_id: string;
  org_slug: string;
  org_name: string;
}

function toTicket(row: TicketRow) {
  return {
    id: row.id,
    status: row.status,
    createdAt: iso(row.created_at),
    checkedInAt: isoOrNull(row.checked_in_at),
    cancelledAt: isoOrNull(row.cancelled_at),
    ticketType: { id: row.ticket_type_id, name: row.ticket_type_name },
    event: {
      id: row.event_id,
      title: row.event_title,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      locationName: row.location_name,
      status: row.event_status,
      organization: { id: row.org_id, slug: row.org_slug, name: row.org_name },
    },
  };
}

const ticketQuery = (db: Database) =>
  db
    .selectFrom('tickets as t')
    .innerJoin('ticket_types as tt', 'tt.id', 't.ticket_type_id')
    .innerJoin('events as e', 'e.id', 't.event_id')
    .innerJoin('organizations as o', 'o.id', 'e.organization_id')
    .select(TICKET_COLUMNS);

const ticketNotFound = () => new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

/** Tickets are private: anyone but the holder gets 404. */
export async function getTicket(db: Database, userId: string, ticketId: string) {
  const row = await ticketQuery(db).where('t.id', '=', ticketId).where('t.user_id', '=', userId).executeTakeFirst();
  if (!row) throw ticketNotFound();
  return toTicket(row);
}

export async function listMyTickets(db: Database, userId: string) {
  const rows = await ticketQuery(db).where('t.user_id', '=', userId).orderBy('e.starts_at', 'desc').execute();
  return rows.map(toTicket);
}

function findLiveTicket(db: Database, eventId: string, userId: string) {
  return db
    .selectFrom('tickets')
    .select(['id', 'ticket_type_id'])
    .where('event_id', '=', eventId)
    .where('user_id', '=', userId)
    .where('status', '!=', 'cancelled')
    .executeTakeFirst();
}

async function lifetimePoints(db: Database, userId: string, orgId: string) {
  const row = await db
    .selectFrom('point_balances')
    .select('lifetime_earned')
    .where('user_id', '=', userId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();
  return row?.lifetime_earned ?? 0;
}

interface SalesRules {
  allocation_mode: AllocationMode;
  min_points_required: number;
  priority_points_threshold: number | null;
  priority_sales_starts_at: Date | null;
  sales_starts_at: Date;
  sales_ends_at: Date;
}

/**
 * Who may claim right now. Eligibility uses lifetime points earned in the
 * hosting club, so spending points never costs a member their early access.
 */
export function assertCanClaim(rules: SalesRules, points: number, now: Date) {
  if (rules.allocation_mode === 'lottery') {
    throw new AppError(409, 'LOTTERY_ONLY', 'This ticket type is allocated by lottery; apply instead');
  }
  if (now >= rules.sales_ends_at) {
    throw new AppError(409, 'SALES_CLOSED', 'Sales for this ticket type have closed');
  }
  if (points < rules.min_points_required) {
    throw new AppError(
      403,
      'NOT_ENOUGH_POINTS',
      `Requires ${rules.min_points_required} points from this club; you have ${points}`,
    );
  }
  if (now >= rules.sales_starts_at) return;

  const threshold = rules.priority_points_threshold;
  const earlyStart = rules.priority_sales_starts_at;
  if (rules.allocation_mode === 'priority' && threshold !== null && earlyStart !== null) {
    if (points >= threshold) {
      if (now >= earlyStart) return;
      throw new AppError(409, 'SALES_NOT_OPEN', `Early access for you opens at ${iso(earlyStart)}`);
    }
    throw new AppError(
      409,
      'SALES_NOT_OPEN',
      `Early access is for members with ${threshold}+ points; general sales open at ${iso(rules.sales_starts_at)}`,
    );
  }
  throw new AppError(409, 'SALES_NOT_OPEN', `Sales open at ${iso(rules.sales_starts_at)}`);
}

/**
 * Claims one ticket. Capacity is guarded by a conditional increment on the
 * ticket type row, so concurrent claims serialise on that row and can never
 * oversell. Repeating a claim (a retried request, a double tap) returns the
 * ticket already held instead of failing.
 */
export async function claimTicket(db: Database, userId: string, eventId: string, ticketTypeId: string) {
  const existingOrConflict = async (exec: Database) => {
    const existing = await findLiveTicket(exec, eventId, userId);
    if (!existing) return undefined;
    if (existing.ticket_type_id !== ticketTypeId) {
      throw new AppError(409, 'ALREADY_HAS_TICKET', 'You already hold another ticket for this event');
    }
    return { ticket: await getTicket(exec, userId, existing.id), created: false };
  };

  try {
    return await db.transaction().execute(async (trx) => {
      // FOR SHARE: claims run side by side, but an organizer cancelling the
      // event waits for them, so no ticket slips in after the cancellation.
      const event = await trx
        .selectFrom('events')
        .select(['status', 'organization_id'])
        .where('id', '=', eventId)
        .forShare()
        .executeTakeFirst();
      const rules = await trx
        .selectFrom('ticket_types')
        .select([
          'allocation_mode',
          'min_points_required',
          'priority_points_threshold',
          'priority_sales_starts_at',
          'sales_starts_at',
          'sales_ends_at',
        ])
        .where('id', '=', ticketTypeId)
        .where('event_id', '=', eventId)
        .executeTakeFirst();
      if (!event || !rules || event.status === 'draft') {
        throw new AppError(404, 'TICKET_TYPE_NOT_FOUND', 'Ticket type not found');
      }
      if (event.status !== 'published') {
        throw new AppError(409, 'EVENT_NOT_OPEN', `This event is ${event.status}`);
      }

      const held = await existingOrConflict(trx);
      if (held) return held;

      assertCanClaim(rules, await lifetimePoints(trx, userId, event.organization_id), new Date());

      const seat = await trx
        .updateTable('ticket_types')
        .set((eb) => ({ issued_count: eb('issued_count', '+', 1) }))
        .where('id', '=', ticketTypeId)
        .whereRef('issued_count', '<', 'capacity')
        .returning('id')
        .executeTakeFirst();
      if (!seat) throw new AppError(409, 'SOLD_OUT', 'No tickets of this type are left');

      const { id } = await trx
        .insertInto('tickets')
        .values({ ticket_type_id: ticketTypeId, event_id: eventId, user_id: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { ticket: await getTicket(trx, userId, id), created: true };
    });
  } catch (err) {
    // A parallel claim by the same user committed first; its seat is the one they keep.
    if (isUniqueViolation(err, 'tickets_one_live_per_user_event')) {
      const held = await existingOrConflict(db);
      if (held) return held;
    }
    throw err;
  }
}

/**
 * Hands the holder's device the key it renders rotating QR codes with. A ticket
 * lives on one device: asking from a different device bumps the key version,
 * which kills every code the previous device can still produce.
 */
export async function issueQrKey(
  db: Database,
  masterKey: Uint8Array,
  userId: string,
  ticketId: string,
  deviceId: string,
) {
  return db.transaction().execute(async (trx) => {
    const ticket = await trx
      .selectFrom('tickets')
      .select(['status', 'qr_key_version', 'bound_device_id'])
      .where('id', '=', ticketId)
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!ticket) throw ticketNotFound();
    if (ticket.status === 'cancelled') throw new AppError(409, 'TICKET_CANCELLED', 'This ticket was cancelled');
    if (ticket.status === 'checked_in') {
      throw new AppError(409, 'ALREADY_CHECKED_IN', 'This ticket was already used at the door');
    }

    const deviceChanged = ticket.bound_device_id !== null && ticket.bound_device_id !== deviceId;
    const keyVersion = deviceChanged ? ticket.qr_key_version + 1 : ticket.qr_key_version;
    if (ticket.bound_device_id !== deviceId) {
      await trx
        .updateTable('tickets')
        .set({ bound_device_id: deviceId, qr_key_version: keyVersion })
        .where('id', '=', ticketId)
        .execute();
    }

    return {
      ticketId,
      key: encodeTicketKey(deriveTicketKey(masterKey, ticketId, keyVersion)),
      keyVersion,
      deviceChanged,
      stepSeconds: QR_STEP_SECONDS,
      toleranceSteps: QR_TOLERANCE_STEPS,
      serverTime: new Date().toISOString(),
    };
  });
}

/** Gives the seat back. Allowed until the event starts; repeating it is harmless. */
export async function cancelTicket(db: Database, userId: string, ticketId: string) {
  await db.transaction().execute(async (trx) => {
    const ticket = await trx
      .selectFrom('tickets')
      .select(['status', 'ticket_type_id', 'event_id'])
      .where('id', '=', ticketId)
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!ticket) throw ticketNotFound();
    if (ticket.status === 'cancelled') return;
    if (ticket.status === 'checked_in') {
      throw new AppError(409, 'ALREADY_CHECKED_IN', 'A ticket that was used at the door cannot be cancelled');
    }

    const { starts_at } = await trx
      .selectFrom('events')
      .select('starts_at')
      .where('id', '=', ticket.event_id)
      .executeTakeFirstOrThrow();
    if (new Date() >= starts_at) {
      throw new AppError(409, 'TOO_LATE_TO_CANCEL', 'Tickets can only be cancelled before the event starts');
    }

    await trx
      .updateTable('tickets')
      .set({ status: 'cancelled', cancelled_at: new Date() })
      .where('id', '=', ticketId)
      .execute();
    await trx
      .updateTable('ticket_types')
      .set((eb) => ({ issued_count: eb('issued_count', '-', 1) }))
      .where('id', '=', ticket.ticket_type_id)
      .execute();
  });
  return getTicket(db, userId, ticketId);
}
