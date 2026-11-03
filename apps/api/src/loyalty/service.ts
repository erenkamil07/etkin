import type { Database } from '../db.js';
import { iso } from '../schemas.js';

const HISTORY_LIMIT = 20;

/** Points per club plus totals, and the latest ledger entries with the event that earned them. */
export async function getMyPoints(db: Database, userId: string) {
  const clubs = await db
    .selectFrom('point_balances as b')
    .innerJoin('organizations as o', 'o.id', 'b.organization_id')
    .select(['o.id', 'o.slug', 'o.name', 'b.balance', 'b.lifetime_earned'])
    .where('b.user_id', '=', userId)
    .orderBy('b.lifetime_earned', 'desc')
    .orderBy('o.name')
    .execute();

  const history = await db
    .selectFrom('point_ledger as l')
    .innerJoin('organizations as o', 'o.id', 'l.organization_id')
    .leftJoin('check_ins as c', 'c.id', 'l.check_in_id')
    .leftJoin('events as e', 'e.id', 'c.event_id')
    .select([
      'l.delta',
      'l.reason',
      'l.note',
      'l.created_at',
      'o.id as org_id',
      'o.slug as org_slug',
      'o.name as org_name',
      'e.id as event_id',
      'e.title as event_title',
    ])
    .where('l.user_id', '=', userId)
    .orderBy('l.id', 'desc')
    .limit(HISTORY_LIMIT)
    .execute();

  return {
    balance: clubs.reduce((sum, club) => sum + club.balance, 0),
    lifetimeEarned: clubs.reduce((sum, club) => sum + club.lifetime_earned, 0),
    clubs: clubs.map((club) => ({
      organization: { id: club.id, slug: club.slug, name: club.name },
      balance: club.balance,
      lifetimeEarned: club.lifetime_earned,
    })),
    history: history.map((entry) => ({
      delta: entry.delta,
      reason: entry.reason,
      note: entry.note,
      at: iso(entry.created_at),
      organization: { id: entry.org_id, slug: entry.org_slug, name: entry.org_name },
      event: entry.event_id && entry.event_title ? { id: entry.event_id, title: entry.event_title } : null,
    })),
  };
}

export async function getMyBadges(db: Database, userId: string) {
  const rows = await db
    .selectFrom('user_badges as ub')
    .innerJoin('badges as b', 'b.id', 'ub.badge_id')
    .leftJoin('organizations as o', 'o.id', 'b.organization_id')
    .select([
      'b.code',
      'b.name',
      'b.description',
      'b.icon_url',
      'ub.awarded_at',
      'o.id as org_id',
      'o.slug as org_slug',
      'o.name as org_name',
    ])
    .where('ub.user_id', '=', userId)
    .orderBy('ub.awarded_at', 'desc')
    .execute();

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    iconUrl: row.icon_url,
    awardedAt: iso(row.awarded_at),
    organization:
      row.org_id && row.org_slug && row.org_name ? { id: row.org_id, slug: row.org_slug, name: row.org_name } : null,
  }));
}
