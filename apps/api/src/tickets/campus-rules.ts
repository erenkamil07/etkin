import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import type { NoShowRule } from '../orgs/service.js';
import { universityName } from '../universities/service.js';

const DAY_MS = 86_400_000;
/** No-shows older than this no longer count against anyone. */
const NO_SHOW_WINDOW_MS = 90 * DAY_MS;

/**
 * When someone's ban from a club ends, or null if they may get its tickets. A no-show
 * is a ticket still live (neither used nor cancelled) for one of the club's events
 * that ended in the last 90 days, unless an organizer excused it. Reaching the
 * limit bars them for the club's chosen days, counted from their latest no-show.
 */
export async function noShowBanUntil(
  db: Database,
  userId: string,
  orgId: string,
  rule: NoShowRule,
  now = new Date(),
): Promise<Date | null> {
  const noShows = await db
    .selectFrom('tickets as t')
    .innerJoin('events as e', 'e.id', 't.event_id')
    .select('e.ends_at')
    .where('t.user_id', '=', userId)
    .where('e.organization_id', '=', orgId)
    .where('t.status', '=', 'active')
    .where('t.excused_at', 'is', null)
    .where('e.status', 'in', ['published', 'completed'])
    .where('e.ends_at', '<', now)
    .where('e.ends_at', '>', new Date(now.getTime() - NO_SHOW_WINDOW_MS))
    .orderBy('e.ends_at', 'desc')
    .execute();
  const latest = noShows[0];
  if (!latest || noShows.length < rule.limit) return null;
  const until = new Date(latest.ends_at.getTime() + rule.banDays * DAY_MS);
  return until > now ? until : null;
}

/**
 * The club's own rules for who gets its tickets, checked on every claim: a
 * university-only event takes its university's students only, and a club's
 * no-show rule keeps out people who keep skipping its events.
 */
export async function assertCampusRules(db: Database, userId: string, eventId: string) {
  const event = await db
    .selectFrom('events as e')
    .innerJoin('organizations as o', 'o.id', 'e.organization_id')
    .select([
      'e.university_only',
      'e.organization_id',
      'o.university_id',
      universityName('o.university_id'),
      'o.no_show_limit',
      'o.no_show_ban_days',
    ])
    .where('e.id', '=', eventId)
    .executeTakeFirstOrThrow();

  // A club that has since dropped its university has nothing to compare against.
  if (event.university_only && event.university_id !== null) {
    const user = await db
      .selectFrom('users')
      .select('university_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (user.university_id !== event.university_id) {
      throw new AppError(
        403,
        'UNIVERSITY_ONLY',
        `Only students of ${event.university_name} can get tickets to this event`,
      );
    }
  }

  if (event.no_show_limit !== null && event.no_show_ban_days !== null) {
    const rule = { limit: event.no_show_limit, banDays: event.no_show_ban_days };
    const until = await noShowBanUntil(db, userId, event.organization_id, rule);
    if (until) {
      throw new AppError(403, 'NO_SHOW_LIMIT', "Too many no-shows at this club's recent events", {
        until: until.toISOString(),
      });
    }
  }
}
