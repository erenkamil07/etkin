import { sql } from 'kysely';
import { findOrgRole } from '../auth/plugin.js';
import type { AuthUser } from '../auth/tokens.js';
import type { AllocationMode, EventStatus } from '../db/schema.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { iso, isoOrNull } from '../schemas.js';
import { universityName, universityRef } from '../universities/service.js';

export interface EventInput {
  title: string;
  description?: string | null | undefined;
  locationName?: string | null | undefined;
  coverImageUrl?: string | null | undefined;
  startsAt: Date;
  endsAt: Date;
  checkinOpensAt?: Date | undefined;
  checkinClosesAt?: Date | undefined;
  checkinPoints?: number | undefined;
  priceIncludes?: string | null | undefined;
  paymentInfo?: string | null | undefined;
}

export type EventPatch = Partial<EventInput>;

export interface TicketTypeInput {
  name: string;
  description?: string | null | undefined;
  capacity: number;
  priceCents?: number | undefined;
  allocationMode?: AllocationMode | undefined;
  minPointsRequired?: number | undefined;
  priorityPointsThreshold?: number | null | undefined;
  prioritySalesStartsAt?: Date | null | undefined;
  salesStartsAt?: Date | undefined;
  salesEndsAt?: Date | undefined;
}

export type TicketTypePatch = Partial<TicketTypeInput>;

const CHECKIN_OPENS_BEFORE_START_MS = 60 * 60 * 1000;
const FEED_MAX_LIMIT = 50;

const eventNotFound = () => new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');
const ticketTypeNotFound = () => new AppError(404, 'TICKET_TYPE_NOT_FOUND', 'Ticket type not found');

/**
 * Doors open an hour before the start and close when the event ends, unless set explicitly.
 * Checks the times first: a window derived from bad times would otherwise surface as a
 * confusing INVALID_CHECKIN_WINDOW for a window the organizer never sent.
 */
function defaultCheckinWindow(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw new AppError(400, 'INVALID_EVENT_TIMES', 'endsAt must be after startsAt');
  return { checkin_opens_at: new Date(startsAt.getTime() - CHECKIN_OPENS_BEFORE_START_MS), checkin_closes_at: endsAt };
}

// --- reading -----------------------------------------------------------------

const EVENT_COLUMNS = [
  'e.id',
  'e.organization_id',
  'o.slug as org_slug',
  'o.name as org_name',
  'o.university_id as org_university_id',
  universityName('o.university_id'),
  'e.title',
  'e.description',
  'e.location_name',
  'e.cover_image_url',
  'e.starts_at',
  'e.ends_at',
  'e.checkin_opens_at',
  'e.checkin_closes_at',
  'e.checkin_points',
  'e.price_includes',
  'e.payment_info',
  'e.status',
  'e.published_at',
] as const;

interface EventRow {
  id: string;
  organization_id: string;
  org_slug: string;
  org_name: string;
  org_university_id: number | null;
  university_name: string | null;
  title: string;
  description: string | null;
  location_name: string | null;
  cover_image_url: string | null;
  starts_at: Date;
  ends_at: Date;
  checkin_opens_at: Date;
  checkin_closes_at: Date;
  checkin_points: number;
  price_includes: string | null;
  payment_info: string | null;
  status: EventStatus;
  published_at: Date | null;
}

function toEvent(row: EventRow) {
  return {
    id: row.id,
    organization: {
      id: row.organization_id,
      slug: row.org_slug,
      name: row.org_name,
      university: universityRef(row.org_university_id, row.university_name),
    },
    title: row.title,
    description: row.description,
    locationName: row.location_name,
    coverImageUrl: row.cover_image_url,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    checkinOpensAt: iso(row.checkin_opens_at),
    checkinClosesAt: iso(row.checkin_closes_at),
    checkinPoints: row.checkin_points,
    priceIncludes: row.price_includes,
    paymentInfo: row.payment_info,
    status: row.status,
    publishedAt: isoOrNull(row.published_at),
  };
}

// Totals across an event's ticket types, for list cards ("12 places left", "₺150'den").
// Queries using these must alias events as "e".
const CAPACITY_TOTALS = [
  sql<number>`(select coalesce(sum(tt.capacity), 0)::int from ticket_types tt where tt.event_id = e.id)`.as('capacity'),
  sql<number>`(select coalesce(sum(tt.capacity - tt.issued_count), 0)::int from ticket_types tt where tt.event_id = e.id)`.as(
    'remaining',
  ),
  sql<number>`(select coalesce(min(tt.price_cents), 0)::int from ticket_types tt where tt.event_id = e.id)`.as(
    'price_from_cents',
  ),
];

function toEventSummary(row: EventRow & { capacity: number; remaining: number; price_from_cents: number }) {
  return { ...toEvent(row), capacity: row.capacity, remaining: row.remaining, priceFromCents: row.price_from_cents };
}

const TICKET_TYPE_COLUMNS = [
  'id',
  'name',
  'description',
  'capacity',
  'issued_count',
  'price_cents',
  'currency',
  'allocation_mode',
  'min_points_required',
  'priority_points_threshold',
  'priority_sales_starts_at',
  'sales_starts_at',
  'sales_ends_at',
] as const;

function toTicketType(row: {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  issued_count: number;
  price_cents: number;
  currency: string;
  allocation_mode: AllocationMode;
  min_points_required: number;
  priority_points_threshold: number | null;
  priority_sales_starts_at: Date | null;
  sales_starts_at: Date;
  sales_ends_at: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capacity: row.capacity,
    issued: row.issued_count,
    remaining: row.capacity - row.issued_count,
    priceCents: row.price_cents,
    currency: row.currency,
    allocationMode: row.allocation_mode,
    minPointsRequired: row.min_points_required,
    priorityPointsThreshold: row.priority_points_threshold,
    prioritySalesStartsAt: isoOrNull(row.priority_sales_starts_at),
    salesStartsAt: iso(row.sales_starts_at),
    salesEndsAt: iso(row.sales_ends_at),
  };
}

async function loadEventDetail(db: Database, eventId: string) {
  const event = await db
    .selectFrom('events as e')
    .innerJoin('organizations as o', 'o.id', 'e.organization_id')
    .select(EVENT_COLUMNS)
    .where('e.id', '=', eventId)
    .executeTakeFirst();
  if (!event) throw eventNotFound();

  const ticketTypes = await db
    .selectFrom('ticket_types')
    .select(TICKET_TYPE_COLUMNS)
    .where('event_id', '=', eventId)
    .orderBy('created_at')
    .execute();
  return { ...toEvent(event), ticketTypes: ticketTypes.map(toTicketType) };
}

/** Drafts exist only for their club's team (and admins); everyone else gets 404. */
export async function getEvent(db: Database, eventId: string, viewer: AuthUser | null) {
  const event = await loadEventDetail(db, eventId);
  if (event.status === 'draft') {
    const canSee =
      viewer?.platformRole === 'admin' || (viewer && (await findOrgRole(db, event.organization.id, viewer.id)));
    if (!canSee) throw eventNotFound();
  }
  return event;
}

function encodeCursor(startsAt: Date, id: string) {
  return Buffer.from(JSON.stringify([startsAt.toISOString(), id])).toString('base64url');
}

function decodeCursor(cursor: string): [Date, string] {
  try {
    const [startsAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const date = new Date(startsAt);
    if (Number.isNaN(date.getTime()) || typeof id !== 'string') throw new Error('bad cursor');
    return [date, id];
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'cursor is not a value returned by this endpoint');
  }
}

/** Public feed: published events that haven't ended, soonest first, keyset-paginated. */
export async function listUpcomingEvents(
  db: Database,
  {
    orgId,
    universityId,
    limit = 20,
    cursor,
  }: {
    orgId?: string | undefined;
    universityId?: number | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  },
) {
  const pageSize = Math.min(limit, FEED_MAX_LIMIT);
  let query = db
    .selectFrom('events as e')
    .innerJoin('organizations as o', 'o.id', 'e.organization_id')
    .select(EVENT_COLUMNS)
    .select(CAPACITY_TOTALS)
    .where('e.status', '=', 'published')
    .where('e.ends_at', '>', new Date())
    .orderBy('e.starts_at')
    .orderBy('e.id')
    .limit(pageSize + 1);

  if (orgId) query = query.where('e.organization_id', '=', orgId);
  if (universityId) query = query.where('o.university_id', '=', universityId);
  if (cursor) {
    const [startsAt, id] = decodeCursor(cursor);
    query = query.where((eb) => eb(eb.refTuple('e.starts_at', 'e.id'), '>', eb.tuple(startsAt, id)));
  }

  const rows = await query.execute();
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return {
    items: page.map(toEventSummary),
    nextCursor: rows.length > pageSize && last ? encodeCursor(last.starts_at, last.id) : null,
  };
}

/** Everything the club has, drafts included, newest first (for the organizer and scanner apps). */
export async function listOrgEvents(db: Database, orgId: string) {
  const rows = await db
    .selectFrom('events as e')
    .innerJoin('organizations as o', 'o.id', 'e.organization_id')
    .select(EVENT_COLUMNS)
    .select(CAPACITY_TOTALS)
    .where('e.organization_id', '=', orgId)
    .orderBy('e.starts_at', 'desc')
    .limit(200)
    .execute();
  return rows.map(toEventSummary);
}

// --- writing -----------------------------------------------------------------

/** Locks an event of this club for the rest of the transaction; 404 if it belongs to another club. */
async function lockEvent(trx: Database, orgId: string, eventId: string) {
  const event = await trx
    .selectFrom('events')
    .select(['id', 'status', 'starts_at', 'ends_at'])
    .where('id', '=', eventId)
    .where('organization_id', '=', orgId)
    .forUpdate()
    .executeTakeFirst();
  if (!event) throw eventNotFound();
  return event;
}

/**
 * Etkin takes no money: a published event with a paid ticket type must say how
 * to pay the club. Runs inside the write's transaction, after the change.
 */
async function assertPaymentInfo(trx: Database, eventId: string) {
  const event = await trx
    .selectFrom('events as e')
    .select([
      'e.status',
      'e.payment_info',
      sql<boolean>`exists (select 1 from ticket_types tt where tt.event_id = e.id and tt.price_cents > 0)`.as('paid'),
    ])
    .where('e.id', '=', eventId)
    .executeTakeFirstOrThrow();
  if (event.status === 'published' && event.paid && !event.payment_info) {
    throw new AppError(409, 'PAYMENT_INFO_REQUIRED', 'A published paid event needs paymentInfo: how to pay the club');
  }
}

function assertEditable(status: EventStatus) {
  if (status === 'cancelled' || status === 'completed') {
    throw new AppError(409, 'EVENT_NOT_EDITABLE', `A ${status} event can no longer be changed`);
  }
}

export async function createEvent(db: Database, orgId: string, createdBy: string, input: EventInput) {
  const window = defaultCheckinWindow(input.startsAt, input.endsAt);
  const { id } = await db
    .insertInto('events')
    .values({
      organization_id: orgId,
      created_by: createdBy,
      title: input.title,
      description: input.description ?? null,
      location_name: input.locationName ?? null,
      cover_image_url: input.coverImageUrl ?? null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      checkin_opens_at: input.checkinOpensAt ?? window.checkin_opens_at,
      checkin_closes_at: input.checkinClosesAt ?? window.checkin_closes_at,
      checkin_points: input.checkinPoints,
      price_includes: input.priceIncludes ?? null,
      payment_info: input.paymentInfo ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return loadEventDetail(db, id);
}

/** Moving the event resets the check-in window to the default unless a new one is sent too. */
export async function updateEvent(db: Database, orgId: string, eventId: string, patch: EventPatch) {
  await db.transaction().execute(async (trx) => {
    const current = await lockEvent(trx, orgId, eventId);
    assertEditable(current.status);

    const timesMoved = patch.startsAt !== undefined || patch.endsAt !== undefined;
    const windowSent = patch.checkinOpensAt !== undefined || patch.checkinClosesAt !== undefined;
    const resetWindow =
      timesMoved && !windowSent
        ? defaultCheckinWindow(patch.startsAt ?? current.starts_at, patch.endsAt ?? current.ends_at)
        : {};

    await trx
      .updateTable('events')
      .set({
        title: patch.title,
        description: patch.description,
        location_name: patch.locationName,
        cover_image_url: patch.coverImageUrl,
        starts_at: patch.startsAt,
        ends_at: patch.endsAt,
        checkin_opens_at: patch.checkinOpensAt,
        checkin_closes_at: patch.checkinClosesAt,
        checkin_points: patch.checkinPoints,
        price_includes: patch.priceIncludes,
        payment_info: patch.paymentInfo,
        ...resetWindow,
      })
      .where('id', '=', eventId)
      .execute();
    await assertPaymentInfo(trx, eventId);
  });
  return loadEventDetail(db, eventId);
}

export async function publishEvent(db: Database, orgId: string, eventId: string) {
  await db.transaction().execute(async (trx) => {
    const event = await lockEvent(trx, orgId, eventId);
    if (event.status !== 'draft') {
      throw new AppError(
        409,
        'INVALID_STATUS_TRANSITION',
        `Only drafts can be published; this event is ${event.status}`,
      );
    }
    if (event.ends_at <= new Date()) {
      throw new AppError(409, 'EVENT_ALREADY_ENDED', 'This event has already ended');
    }
    const { count } = await trx
      .selectFrom('ticket_types')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('event_id', '=', eventId)
      .executeTakeFirstOrThrow();
    if (count === 0) {
      throw new AppError(409, 'NO_TICKET_TYPES', 'Add at least one ticket type before publishing');
    }
    await trx
      .updateTable('events')
      .set({ status: 'published', published_at: new Date() })
      .where('id', '=', eventId)
      .execute();
    await assertPaymentInfo(trx, eventId);
  });
  return loadEventDetail(db, eventId);
}

export async function cancelEvent(db: Database, orgId: string, eventId: string) {
  await db.transaction().execute(async (trx) => {
    const event = await lockEvent(trx, orgId, eventId);
    if (event.status !== 'draft' && event.status !== 'published') {
      throw new AppError(409, 'INVALID_STATUS_TRANSITION', `A ${event.status} event cannot be cancelled`);
    }
    await cancelLockedEvent(trx, eventId);
  });
  return loadEventDetail(db, eventId);
}

/** Cancels an event the caller has locked FOR UPDATE, with the tickets still active for it. */
export async function cancelLockedEvent(trx: Database, eventId: string) {
  await trx.updateTable('events').set({ status: 'cancelled' }).where('id', '=', eventId).execute();
  // Holders keep a visible, cancelled ticket; claims in flight finished before
  // the event lock was granted (they hold it FOR SHARE).
  await trx
    .updateTable('tickets')
    .set({ status: 'cancelled', cancelled_at: new Date() })
    .where('event_id', '=', eventId)
    .where('status', '=', 'active')
    .execute();
}

/** Housekeeping: published events whose doors have closed become 'completed'. Returns how many. */
export async function completeEndedEvents(db: Database, now = new Date()) {
  const result = await db
    .updateTable('events')
    .set({ status: 'completed' })
    .where('status', '=', 'published')
    .where('ends_at', '<', now)
    .where('checkin_closes_at', '<', now)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Only drafts can be deleted; a published event is cancelled instead so attendees see what happened. */
export async function deleteEvent(db: Database, orgId: string, eventId: string) {
  await db.transaction().execute(async (trx) => {
    const event = await lockEvent(trx, orgId, eventId);
    if (event.status !== 'draft') {
      throw new AppError(409, 'EVENT_NOT_DRAFT', 'Only drafts can be deleted; cancel a published event instead');
    }
    await trx.deleteFrom('events').where('id', '=', eventId).execute();
  });
}

export async function createTicketType(db: Database, orgId: string, eventId: string, input: TicketTypeInput) {
  return db.transaction().execute(async (trx) => {
    const event = await lockEvent(trx, orgId, eventId);
    assertEditable(event.status);
    const row = await trx
      .insertInto('ticket_types')
      .values({
        event_id: eventId,
        name: input.name,
        description: input.description ?? null,
        capacity: input.capacity,
        price_cents: input.priceCents,
        allocation_mode: input.allocationMode,
        min_points_required: input.minPointsRequired,
        priority_points_threshold: input.priorityPointsThreshold ?? null,
        priority_sales_starts_at: input.prioritySalesStartsAt ?? null,
        sales_starts_at: input.salesStartsAt ?? new Date(),
        sales_ends_at: input.salesEndsAt ?? event.starts_at,
      })
      .returning(TICKET_TYPE_COLUMNS)
      .executeTakeFirstOrThrow();
    await assertPaymentInfo(trx, eventId);
    return toTicketType(row);
  });
}

export async function updateTicketType(
  db: Database,
  orgId: string,
  eventId: string,
  ticketTypeId: string,
  patch: TicketTypePatch,
) {
  return db.transaction().execute(async (trx) => {
    assertEditable((await lockEvent(trx, orgId, eventId)).status);
    const row = await trx
      .updateTable('ticket_types')
      .set({
        name: patch.name,
        description: patch.description,
        capacity: patch.capacity,
        price_cents: patch.priceCents,
        allocation_mode: patch.allocationMode,
        min_points_required: patch.minPointsRequired,
        priority_points_threshold: patch.priorityPointsThreshold,
        priority_sales_starts_at: patch.prioritySalesStartsAt,
        sales_starts_at: patch.salesStartsAt,
        sales_ends_at: patch.salesEndsAt,
      })
      .where('id', '=', ticketTypeId)
      .where('event_id', '=', eventId)
      .returning(TICKET_TYPE_COLUMNS)
      .executeTakeFirst();
    if (!row) throw ticketTypeNotFound();
    await assertPaymentInfo(trx, eventId);
    return toTicketType(row);
  });
}

export async function deleteTicketType(db: Database, orgId: string, eventId: string, ticketTypeId: string) {
  await db.transaction().execute(async (trx) => {
    assertEditable((await lockEvent(trx, orgId, eventId)).status);
    const existing = await trx
      .selectFrom('ticket_types')
      .select('issued_count')
      .where('id', '=', ticketTypeId)
      .where('event_id', '=', eventId)
      .executeTakeFirst();
    if (!existing) throw ticketTypeNotFound();
    if (existing.issued_count > 0) {
      throw new AppError(
        409,
        'TICKET_TYPE_IN_USE',
        'Tickets of this type were already issued; lower its capacity instead',
      );
    }
    await trx.deleteFrom('ticket_types').where('id', '=', ticketTypeId).execute();
  });
}
