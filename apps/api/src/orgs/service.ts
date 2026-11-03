import { sql } from 'kysely';
import type { Database } from '../db.js';
import type { OrgRole } from '../db/schema.js';
import { AppError } from '../errors.js';
import { iso } from '../schemas.js';

export interface OrgInput {
  slug: string;
  name: string;
  description?: string | null | undefined;
  logoUrl?: string | null | undefined;
}

export type OrgPatch = Partial<Omit<OrgInput, 'slug'>>;

const ORG_COLUMNS = ['id', 'slug', 'name', 'description', 'logo_url', 'created_at'] as const;

function toOrg(row: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  created_at: Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    logoUrl: row.logo_url,
    createdAt: iso(row.created_at),
  };
}

const orgNotFound = () => new AppError(404, 'ORG_NOT_FOUND', 'Club not found');

/** The creator becomes the club's first owner. */
export async function createOrg(db: Database, ownerId: string, input: OrgInput) {
  return db.transaction().execute(async (trx) => {
    const org = await trx
      .insertInto('organizations')
      .values({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        logo_url: input.logoUrl ?? null,
      })
      .returning(ORG_COLUMNS)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('organization_members')
      .values({ organization_id: org.id, user_id: ownerId, role: 'owner' })
      .execute();
    return toOrg(org);
  });
}

export async function getOrg(db: Database, orgId: string) {
  const org = await db.selectFrom('organizations').select(ORG_COLUMNS).where('id', '=', orgId).executeTakeFirst();
  if (!org) throw orgNotFound();
  return toOrg(org);
}

export async function updateOrg(db: Database, orgId: string, patch: OrgPatch) {
  const org = await db
    .updateTable('organizations')
    .set({ name: patch.name, description: patch.description, logo_url: patch.logoUrl })
    .where('id', '=', orgId)
    .returning(ORG_COLUMNS)
    .executeTakeFirst();
  if (!org) throw orgNotFound();
  return toOrg(org);
}

const MEMBER_COLUMNS = ['u.id', 'u.full_name', 'u.email', 'm.role', 'm.created_at'] as const;

function toMember(row: { id: string; full_name: string; email: string; role: OrgRole; created_at: Date }) {
  return { userId: row.id, fullName: row.full_name, email: row.email, role: row.role, joinedAt: iso(row.created_at) };
}

export async function listMembers(db: Database, orgId: string) {
  const rows = await db
    .selectFrom('organization_members as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select(MEMBER_COLUMNS)
    .where('m.organization_id', '=', orgId)
    .orderBy(sql`array_position(array['owner', 'organizer', 'scanner']::org_role[], m.role)`)
    .orderBy('u.full_name')
    .execute();
  return rows.map(toMember);
}

/**
 * Locks the club row so concurrent role changes are serialised, then refuses
 * to leave the club without an owner.
 */
async function assertAnotherOwner(trx: Database, orgId: string, userId: string) {
  const { owners } = await trx
    .selectFrom('organization_members')
    .select(sql<number>`count(*)::int`.as('owners'))
    .where('organization_id', '=', orgId)
    .where('role', '=', 'owner')
    .where('user_id', '!=', userId)
    .executeTakeFirstOrThrow();
  if (owners === 0) {
    throw new AppError(409, 'LAST_OWNER', 'A club needs at least one owner; make someone else owner first');
  }
}

async function lockOrg(trx: Database, orgId: string) {
  const org = await trx.selectFrom('organizations').select('id').where('id', '=', orgId).forUpdate().executeTakeFirst();
  if (!org) throw orgNotFound();
}

/** Adds a registered user to the club, or changes their role if already a member. */
export async function upsertMember(db: Database, orgId: string, email: string, role: OrgRole) {
  return db.transaction().execute(async (trx) => {
    await lockOrg(trx, orgId);
    const user = await trx
      .selectFrom('users')
      .select('id')
      .where('email', '=', email.trim())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'No account uses this email; ask them to sign up first');

    const current = await trx
      .selectFrom('organization_members')
      .select('role')
      .where('organization_id', '=', orgId)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (current?.role === 'owner' && role !== 'owner') await assertAnotherOwner(trx, orgId, user.id);

    await trx
      .insertInto('organization_members')
      .values({ organization_id: orgId, user_id: user.id, role })
      .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doUpdateSet({ role }))
      .execute();

    const member = await trx
      .selectFrom('organization_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(MEMBER_COLUMNS)
      .where('m.organization_id', '=', orgId)
      .where('m.user_id', '=', user.id)
      .executeTakeFirstOrThrow();
    return toMember(member);
  });
}

export async function removeMember(db: Database, orgId: string, userId: string) {
  await db.transaction().execute(async (trx) => {
    await lockOrg(trx, orgId);
    const current = await trx
      .selectFrom('organization_members')
      .select('role')
      .where('organization_id', '=', orgId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!current) throw new AppError(404, 'MEMBER_NOT_FOUND', 'This user is not a member of the club');
    if (current.role === 'owner') await assertAnotherOwner(trx, orgId, userId);

    await trx
      .deleteFrom('organization_members')
      .where('organization_id', '=', orgId)
      .where('user_id', '=', userId)
      .execute();
  });
}
