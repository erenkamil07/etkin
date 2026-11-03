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

async function attendanceByClub(db: Database, userId: string) {
  const rows = await db
    .selectFrom('check_ins as c')
    .innerJoin('events as e', 'e.id', 'c.event_id')
    .select(['e.organization_id', sql<number>`count(*)::int`.as('count')])
    .where('c.user_id', '=', userId)
    .groupBy('e.organization_id')
    .execute();
  return new Map(rows.map((row) => [row.organization_id, row.count]));
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

  const byClub = await attendanceByClub(db, userId);
  const total = [...byClub.values()].reduce((sum, count) => sum + count, 0);

  const qualifies = (badge: (typeof candidates)[number]): boolean => {
    const rule = Criteria.safeParse(badge.criteria);
    if (!rule.success) return false; // an unknown rule type never awards
    if (rule.data.type === 'distinct_clubs') return byClub.size >= rule.data.gte;
    const count = badge.organization_id ? (byClub.get(badge.organization_id) ?? 0) : total;
    return count >= rule.data.gte;
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
