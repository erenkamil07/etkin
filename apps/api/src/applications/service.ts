import type { ApplicantRole } from '../db/schema.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { iso, isoOrNull } from '../schemas.js';
import { universityName, universityRef } from '../universities/service.js';
import { looksAlike } from './names.js';

/** What the applicant tells the admin so they can check the club is real and theirs. */
export interface ApplicationInput {
  applicantRole: ApplicantRole;
  verificationUrl: string;
  applicationNote?: string | null | undefined;
}

const orgNotFound = () => new AppError(404, 'ORG_NOT_FOUND', 'Club not found');

/**
 * Serialises a person's club applications (two taps on "Başvur" can't both
 * get through), then refuses a second one while another is waiting.
 */
export async function assertNoOpenApplication(trx: Database, userId: string, exceptOrgId?: string) {
  await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().executeTakeFirst();
  let open = trx
    .selectFrom('organizations as o')
    .innerJoin('organization_members as m', 'm.organization_id', 'o.id')
    .select('o.id')
    .where('m.user_id', '=', userId)
    .where('m.role', '=', 'owner')
    .where('o.status', '=', 'pending');
  if (exceptOrgId) open = open.where('o.id', '!=', exceptOrgId);
  if (await open.executeTakeFirst()) {
    throw new AppError(409, 'APPLICATION_PENDING', 'You already have a club application waiting for review');
  }
}

// --- the applicant's side ------------------------------------------------------

export async function getApplication(db: Database, orgId: string) {
  const row = await db
    .selectFrom('organizations')
    .select([
      'status',
      'applicant_role',
      'verification_url',
      'application_note',
      'submitted_at',
      'reviewed_at',
      'rejection_reason',
    ])
    .where('id', '=', orgId)
    .executeTakeFirst();
  if (!row) throw orgNotFound();
  return {
    status: row.status,
    applicantRole: row.applicant_role,
    verificationUrl: row.verification_url,
    applicationNote: row.application_note,
    submittedAt: isoOrNull(row.submitted_at),
    reviewedAt: isoOrNull(row.reviewed_at),
    rejectionReason: row.rejection_reason,
  };
}

/**
 * Updates the application. While it waits this only edits it (it keeps its
 * place in the queue); a refused club applies again and goes to the back.
 */
export async function updateApplication(db: Database, userId: string, orgId: string, input: ApplicationInput) {
  await db.transaction().execute(async (trx) => {
    const org = await trx
      .selectFrom('organizations')
      .select('status')
      .where('id', '=', orgId)
      .forUpdate()
      .executeTakeFirst();
    if (!org) throw orgNotFound();
    if (org.status === 'approved') throw new AppError(409, 'CLUB_ALREADY_APPROVED', 'This club is already approved');
    if (org.status === 'rejected') await assertNoOpenApplication(trx, userId, orgId);
    await trx
      .updateTable('organizations')
      .set({
        applicant_role: input.applicantRole,
        verification_url: input.verificationUrl,
        application_note: input.applicationNote || null,
        ...(org.status === 'rejected' && {
          status: 'pending' as const,
          submitted_at: new Date(),
          reviewed_at: null,
          reviewed_by: null,
        }),
      })
      .where('id', '=', orgId)
      .execute();
  });
  return getApplication(db, orgId);
}

// --- the platform admin's side ------------------------------------------------

export async function listPendingApplications(db: Database) {
  const rows = await db
    .selectFrom('organizations as o')
    // The applicant is the club's first owner (normally its only member by now).
    .leftJoin('organization_members as m', (join) =>
      join.onRef('m.organization_id', '=', 'o.id').on('m.role', '=', 'owner'),
    )
    .leftJoin('users as u', 'u.id', 'm.user_id')
    .distinctOn('o.id')
    .select([
      'o.id',
      'o.slug',
      'o.name',
      'o.description',
      'o.university_id',
      universityName('o.university_id'),
      'o.applicant_role',
      'o.verification_url',
      'o.application_note',
      'o.submitted_at',
      'o.rejection_reason',
      'o.created_at',
      'u.id as applicant_id',
      'u.full_name as applicant_name',
      'u.email as applicant_email',
    ])
    .where('o.status', '=', 'pending')
    .orderBy('o.id')
    .orderBy('m.created_at')
    .limit(200)
    .execute();
  if (rows.length === 0) return [];

  // Clubs already there (or waiting too) at the same universities, to spot copies.
  const universityIds = [...new Set(rows.flatMap((row) => (row.university_id === null ? [] : [row.university_id])))];
  const anyWithout = rows.some((row) => row.university_id === null);
  const others = await db
    .selectFrom('organizations')
    .select(['id', 'name', 'status', 'university_id'])
    .where('status', '!=', 'rejected')
    .where((eb) =>
      eb.or([
        ...(universityIds.length > 0 ? [eb('university_id', 'in', universityIds)] : []),
        ...(anyWithout ? [eb('university_id', 'is', null)] : []),
      ]),
    )
    .execute();

  return rows
    .map((row) => ({
      club: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        university: universityRef(row.university_id, row.university_name),
        createdAt: iso(row.created_at),
      },
      applicant:
        row.applicant_id && row.applicant_name && row.applicant_email
          ? { id: row.applicant_id, fullName: row.applicant_name, email: row.applicant_email }
          : null,
      applicantRole: row.applicant_role,
      verificationUrl: row.verification_url,
      applicationNote: row.application_note,
      submittedAt: iso(row.submitted_at ?? row.created_at),
      previousRejection: row.rejection_reason,
      similarClubs: others
        .filter(
          (other) =>
            other.id !== row.id &&
            other.university_id === row.university_id &&
            looksAlike(other.name, row.name, row.university_name),
        )
        .map((other) => ({ id: other.id, name: other.name, status: other.status })),
    }))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** Approves or refuses a waiting application; deciding twice is refused. */
export async function decideApplication(
  db: Database,
  orgId: string,
  adminId: string,
  decision: { approve: true } | { approve: false; reason: string },
) {
  const decided = await db
    .updateTable('organizations')
    .set({
      status: decision.approve ? 'approved' : 'rejected',
      reviewed_at: new Date(),
      reviewed_by: adminId,
      rejection_reason: decision.approve ? null : decision.reason,
    })
    .where('id', '=', orgId)
    .where('status', '=', 'pending')
    .returning('name')
    .executeTakeFirst();
  if (decided) return decided;
  const exists = await db.selectFrom('organizations').select('id').where('id', '=', orgId).executeTakeFirst();
  if (!exists) throw orgNotFound();
  throw new AppError(409, 'APPLICATION_NOT_PENDING', 'This application has already been decided');
}
