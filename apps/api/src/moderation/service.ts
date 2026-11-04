import type { EventStatus, ReportReason, ReportResolution } from '../db/schema.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { cancelLockedEvent } from '../events/service.js';
import { iso } from '../schemas.js';

const eventNotFound = () => new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');

// What a removed event shows from then on, wherever its title appears (feed
// history, tickets, points). The original text is only in the server log.
export const REMOVED_TITLE = 'Kaldırılan etkinlik';
export const REMOVED_DESCRIPTION = 'Bu etkinlik topluluk kurallarına aykırı bulunduğu için kaldırıldı.';

/** Files or updates the person's open report. Drafts can't be reported: nobody outside the club can see them. */
export async function reportEvent(
  db: Database,
  reporterId: string,
  eventId: string,
  { reason, details }: { reason: ReportReason; details?: string | null | undefined },
) {
  const event = await db.selectFrom('events').select('status').where('id', '=', eventId).executeTakeFirst();
  if (!event || event.status === 'draft') throw eventNotFound();
  const report = { reason, details: details || null };
  await db
    .insertInto('event_reports')
    .values({ event_id: eventId, reporter_id: reporterId, ...report })
    .onConflict((oc) => oc.columns(['event_id', 'reporter_id']).where('resolved_at', 'is', null).doUpdateSet(report))
    .execute();
}

interface ReportedEvent {
  event: {
    id: string;
    title: string;
    status: EventStatus;
    startsAt: string;
    organization: { id: string; name: string };
  };
  reports: { id: string; reason: ReportReason; details: string | null; createdAt: string }[];
}

/** The review queue: events with open reports, most reported first. Reporters stay anonymous here too. */
export async function listOpenReports(db: Database) {
  const rows = await db
    .selectFrom('event_reports as r')
    .innerJoin('events as e', 'e.id', 'r.event_id')
    .innerJoin('organizations as o', 'o.id', 'e.organization_id')
    .select([
      'r.id',
      'r.reason',
      'r.details',
      'r.created_at',
      'e.id as event_id',
      'e.title',
      'e.status',
      'e.starts_at',
      'o.id as org_id',
      'o.name as org_name',
    ])
    .where('r.resolved_at', 'is', null)
    .orderBy('r.created_at', 'desc')
    .limit(500)
    .execute();

  const byEvent = new Map<string, ReportedEvent>();
  for (const row of rows) {
    let entry = byEvent.get(row.event_id);
    if (!entry) {
      entry = {
        event: {
          id: row.event_id,
          title: row.title,
          status: row.status,
          startsAt: iso(row.starts_at),
          organization: { id: row.org_id, name: row.org_name },
        },
        reports: [],
      };
      byEvent.set(row.event_id, entry);
    }
    entry.reports.push({ id: row.id, reason: row.reason, details: row.details, createdAt: iso(row.created_at) });
  }
  // Rows came newest first, so among equally reported events the latest report leads.
  return [...byEvent.values()].sort((a, b) => b.reports.length - a.reports.length);
}

async function resolveOpenReports(trx: Database, eventId: string, resolution: ReportResolution, adminId: string) {
  await trx
    .updateTable('event_reports')
    .set({ resolved_at: new Date(), resolved_by: adminId, resolution })
    .where('event_id', '=', eventId)
    .where('resolved_at', 'is', null)
    .execute();
}

/**
 * Takes an event down: cancels it if it hasn't happened yet (tickets too) and
 * replaces its text, then closes its reports. Returns the original title for the log.
 */
export async function removeEvent(db: Database, eventId: string, adminId: string) {
  return db.transaction().execute(async (trx) => {
    const event = await trx
      .selectFrom('events')
      .select(['status', 'title'])
      .where('id', '=', eventId)
      .forUpdate()
      .executeTakeFirst();
    if (!event) throw eventNotFound();
    if (event.status === 'draft' || event.status === 'published') await cancelLockedEvent(trx, eventId);
    await trx
      .updateTable('events')
      .set({ title: REMOVED_TITLE, description: REMOVED_DESCRIPTION, location_name: null, cover_image_url: null })
      .where('id', '=', eventId)
      .execute();
    await resolveOpenReports(trx, eventId, 'removed', adminId);
    return { originalTitle: event.title };
  });
}

/** Closes an event's open reports without touching the event. */
export async function dismissReports(db: Database, eventId: string, adminId: string) {
  await resolveOpenReports(db, eventId, 'dismissed', adminId);
}
