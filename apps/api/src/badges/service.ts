import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db.js';

/**
 * Badge rules stored in badges.criteria. A club badge (organization_id set)
 * counts only that club's events; a platform badge counts everything.
 */
const Criteria = z.discriminatedUnion('type', [
  z.object({ type: z.literal('checkin_count'), gte: z.number().int().positive() }),
  z.object({ type: z.literal('distinct_clubs'), gte: z.number().int().positive() }),
]);

/** Check-ins per club for one user. */
type Attendance = Map<string, number>;

async function attendanceByClub(db: Database, userId: string): Promise<Attendance> {
  const rows = await db
    .selectFrom('check_ins as c')
    .innerJoin('events as e', 'e.id', 'c.event_id')
    .select(['e.organization_id', sql<number>`count(*)::int`.as('count')])
    .where('c.user_id', '=', userId)
    .groupBy('e.organization_id')
    .execute();
  return new Map(rows.map((row) => [row.organization_id, row.count]));
}

/** Where the user stands on a rule; the badge is earned once this reaches `rule.gte`. */
function progressOf(rule: z.infer<typeof Criteria>, organizationId: string | null, attendance: Attendance): number {
  if (rule.type === 'distinct_clubs') return attendance.size;
  if (organizationId) return attendance.get(organizationId) ?? 0;
  return [...attendance.values()].reduce((sum, count) => sum + count, 0);
}

/**
 * Awards every badge the user now qualifies for after a check-in at a club's
 * event. Safe to run twice for the same check-in: awards are keyed by
 * (user, badge). Returns the codes newly awarded.
 */
export async function awardBadgesAfterCheckIn(
  db: Database,
  { userId, organizationId, checkInId }: { userId: string; organizationId: string; checkInId: string },
): Promise<string[]> {
  const candidates = await db
    .selectFrom('badges as b')
    .select(['b.id', 'b.code', 'b.organization_id', 'b.criteria'])
    .where('b.is_active', '=', true)
    .where((eb) => eb.or([eb('b.organization_id', 'is', null), eb('b.organization_id', '=', organizationId)]))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('user_badges as ub')
            .select('ub.badge_id')
            .whereRef('ub.badge_id', '=', 'b.id')
            .where('ub.user_id', '=', userId),
        ),
      ),
    )
    .execute();
  if (candidates.length === 0) return [];

  const attendance = await attendanceByClub(db, userId);
  const qualifies = (badge: (typeof candidates)[number]): boolean => {
    const rule = Criteria.safeParse(badge.criteria);
    if (!rule.success) return false; // an unknown rule type never awards
    return progressOf(rule.data, badge.organization_id, attendance) >= rule.data.gte;
  };
  const earned = candidates.filter(qualifies);
  if (earned.length === 0) return [];

  const inserted = await db
    .insertInto('user_badges')
    .values(earned.map((badge) => ({ user_id: userId, badge_id: badge.id, check_in_id: checkInId })))
    .onConflict((oc) => oc.columns(['user_id', 'badge_id']).doNothing())
    .returning('badge_id')
    .execute();
  const insertedIds = new Set(inserted.map((row) => row.badge_id));
  return earned.filter((badge) => insertedIds.has(badge.id)).map((badge) => badge.code);
}

/**
 * Badges the user has not earned yet and how close they are, nearest first:
 * every platform badge, plus club badges of clubs whose events they attended.
 */
export async function getBadgeProgress(db: Database, userId: string) {
  const attendance = await attendanceByClub(db, userId);
  const clubs = [...attendance.keys()];
  const rows = await db
    .selectFrom('badges as b')
    .leftJoin('organizations as o', 'o.id', 'b.organization_id')
    .select([
      'b.code',
      'b.name',
      'b.description',
      'b.icon_url',
      'b.criteria',
      'b.organization_id',
      'o.slug as org_slug',
      'o.name as org_name',
    ])
    .where('b.is_active', '=', true)
    .where((eb) =>
      eb.or([eb('b.organization_id', 'is', null), ...(clubs.length > 0 ? [eb('b.organization_id', 'in', clubs)] : [])]),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('user_badges as ub')
            .select('ub.badge_id')
            .whereRef('ub.badge_id', '=', 'b.id')
            .where('ub.user_id', '=', userId),
        ),
      ),
    )
    .execute();

  return rows
    .flatMap((row) => {
      const rule = Criteria.safeParse(row.criteria);
      if (!rule.success) return []; // nothing to show progress against
      const target = rule.data.gte;
      // The worker may not have awarded it yet; never show more than the target.
      const current = Math.min(progressOf(rule.data, row.organization_id, attendance), target);
      return [
        {
          code: row.code,
          name: row.name,
          description: row.description,
          iconUrl: row.icon_url,
          organization:
            row.organization_id && row.org_slug && row.org_name
              ? { id: row.organization_id, slug: row.org_slug, name: row.org_name }
              : null,
          rule: rule.data.type,
          current,
          target,
        },
      ];
    })
    .sort((a, b) => b.current / b.target - a.current / a.target || a.target - b.target);
}
