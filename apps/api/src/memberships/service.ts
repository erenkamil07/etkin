import { sql } from 'kysely';
import { findOrgRole } from '../auth/plugin.js';
import type { MembershipStatus } from '../db/schema.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { isoOrNull } from '../schemas.js';
import { universityName, universityRef } from '../universities/service.js';

/**
 * Club membership: a student asks to join, the club's organizers approve or
 * refuse. Members (and the club team, who always count) can get tickets to the
 * club's members-only events. Organizers see the student number to check the
 * request against their own member list, so asking needs one.
 */

const notFound = () => new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'No membership or request for this club');

function toMyMembership(row: { status: MembershipStatus; requested_at: Date; decided_at: Date | null }) {
  return {
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    decidedAt: isoOrNull(row.decided_at),
  };
}

/** Your membership of a club, or null when you never asked (or left). */
export async function getMyMembership(db: Database, orgId: string, userId: string) {
  const row = await db
    .selectFrom('club_memberships')
    .select(['status', 'requested_at', 'decided_at'])
    .where('organization_id', '=', orgId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row ? toMyMembership(row) : null;
}

/**
 * Asks to join. Asking again while waiting or once a member changes nothing; asking
 * after a refusal puts the request back in the queue.
 */
export async function requestMembership(db: Database, orgId: string, userId: string) {
  return db.transaction().execute(async (trx) => {
    const club = await trx.selectFrom('organizations').select('status').where('id', '=', orgId).executeTakeFirst();
    if (!club) throw new AppError(404, 'ORG_NOT_FOUND', 'Club not found');
    if (club.status !== 'approved') {
      throw new AppError(409, 'CLUB_NOT_APPROVED', 'This club is still waiting for approval');
    }
    if (await findOrgRole(trx, orgId, userId)) {
      throw new AppError(409, 'ALREADY_IN_TEAM', "You are on this club's team, which already counts as a member");
    }
    const user = await trx.selectFrom('users').select('student_number').where('id', '=', userId).executeTakeFirst();
    if (!user?.student_number) {
      throw new AppError(
        409,
        'STUDENT_NUMBER_REQUIRED',
        'Add your student number to your profile before joining a club',
      );
    }

    const row = await trx
      .insertInto('club_memberships')
      .values({ organization_id: orgId, user_id: userId })
      .onConflict((oc) =>
        oc
          .columns(['organization_id', 'user_id'])
          .doUpdateSet({ status: 'pending', requested_at: new Date(), decided_at: null, decided_by: null })
          .where('club_memberships.status', '=', 'rejected'),
      )
      .returning(['status', 'requested_at', 'decided_at'])
      .executeTakeFirst();
    // No row back: it was already pending or approved, and stays so.
    if (row) return toMyMembership(row);
    const current = await getMyMembership(trx, orgId, userId);
    if (!current) throw notFound();
    return current;
  });
}

/** Leaving the club, or withdrawing a request. */
export async function leaveClub(db: Database, orgId: string, userId: string) {
  const deleted = await db
    .deleteFrom('club_memberships')
    .where('organization_id', '=', orgId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (deleted.numDeletedRows === 0n) throw notFound();
}

/** Requests waiting for a decision (oldest first) or the members (by name), for the club's organizers. */
export async function listMemberships(db: Database, orgId: string, status: 'pending' | 'approved') {
  const rows = await db
    .selectFrom('club_memberships as cm')
    .innerJoin('users as person', 'person.id', 'cm.user_id')
    .select([
      'person.id',
      'person.full_name',
      'person.avatar_url',
      'person.student_number',
      'person.university_id',
      // Not "u": the helper's subquery calls universities "u".
      universityName('person.university_id'),
      'cm.status',
      'cm.requested_at',
      'cm.decided_at',
    ])
    .where('cm.organization_id', '=', orgId)
    .where('cm.status', '=', status)
    .where('person.deleted_at', 'is', null)
    .orderBy(status === 'pending' ? 'cm.requested_at' : 'person.full_name')
    .execute();
  return rows.map((row) => ({
    userId: row.id,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    studentNumber: row.student_number,
    university: universityRef(row.university_id, row.university_name),
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    decidedAt: isoOrNull(row.decided_at),
  }));
}

/** Approves or refuses a waiting request; a request already decided is a 409. */
export async function decideMembership(
  db: Database,
  orgId: string,
  userId: string,
  deciderId: string,
  approve: boolean,
) {
  const row = await db
    .updateTable('club_memberships')
    .set({ status: approve ? 'approved' : 'rejected', decided_at: new Date(), decided_by: deciderId })
    .where('organization_id', '=', orgId)
    .where('user_id', '=', userId)
    .where('status', '=', 'pending')
    .returning(['status', 'requested_at', 'decided_at'])
    .executeTakeFirst();
  if (row) return toMyMembership(row);
  if (await getMyMembership(db, orgId, userId)) {
    throw new AppError(409, 'MEMBERSHIP_NOT_PENDING', 'This request has already been answered');
  }
  throw notFound();
}

/** Takes someone off the member list (organizers). */
export async function removeClubMember(db: Database, orgId: string, userId: string) {
  return leaveClub(db, orgId, userId);
}

/** Approved members and the club team can get members-only tickets. */
export async function isClubMember(db: Database, orgId: string, userId: string) {
  const row = await db
    .selectNoFrom((eb) =>
      eb
        .or([
          eb.exists(
            eb
              .selectFrom('club_memberships')
              .select(sql`1`.as('one'))
              .where('organization_id', '=', orgId)
              .where('user_id', '=', userId)
              .where('status', '=', 'approved'),
          ),
          eb.exists(
            eb
              .selectFrom('organization_members')
              .select(sql`1`.as('one'))
              .where('organization_id', '=', orgId)
              .where('user_id', '=', userId),
          ),
        ])
        .as('member'),
    )
    .executeTakeFirstOrThrow();
  return Boolean(row.member);
}

/** The clubs you belong to or asked to join, for the profile and the event pages. */
export async function myClubs(db: Database, userId: string) {
  const rows = await db
    .selectFrom('club_memberships as cm')
    .innerJoin('organizations as o', 'o.id', 'cm.organization_id')
    .select(['o.id', 'o.slug', 'o.name', 'cm.status', 'cm.requested_at', 'cm.decided_at'])
    .where('cm.user_id', '=', userId)
    .orderBy('o.name')
    .execute();
  return rows.map((row) => ({
    organizationId: row.id,
    slug: row.slug,
    name: row.name,
    ...toMyMembership(row),
  }));
}

/** Waiting requests per club, for the badges on the organizers' profile. */
export async function pendingRequestCounts(db: Database, orgIds: string[]) {
  if (orgIds.length === 0) return new Map<string, number>();
  const rows = await db
    .selectFrom('club_memberships')
    .select(['organization_id', sql<number>`count(*)::int`.as('pending')])
    .where('organization_id', 'in', orgIds)
    .where('status', '=', 'pending')
    .groupBy('organization_id')
    .execute();
  return new Map(rows.map((row) => [row.organization_id, row.pending]));
}

/** Approved members, for the public club page. */
export function memberCount(orgColumn: string) {
  return sql<number>`(select count(*)::int from club_memberships cm where cm.organization_id = ${sql.ref(orgColumn)} and cm.status = 'approved')`.as(
    'member_count',
  );
}
