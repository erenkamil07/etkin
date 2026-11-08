import { randomUUID } from 'node:crypto';
import type { PlatformRole } from '../db/schema.js';
import { type Database, isUniqueViolation } from '../db.js';
import { AppError } from '../errors.js';
import {
  assertUniversity,
  nextUniversityChosenAt,
  universityLockedUntil,
  universityName,
  universityRef,
} from '../universities/service.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { type AccessTokens, hashRefreshToken, newRefreshToken } from './tokens.js';

export interface AuthDeps {
  db: Database;
  accessTokens: AccessTokens;
  refreshTokenTtlDays: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  universityId?: number | null | undefined;
  studentNumber?: string | undefined;
  deviceId?: string | undefined;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceId?: string | undefined;
}

const USER_COLUMNS = [
  'id',
  'email',
  'full_name',
  'university_id',
  universityName('users.university_id'),
  'university_chosen_at',
  'student_number',
  'avatar_url',
  'platform_role',
  'created_at',
] as const;

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  university_id: number | null;
  university_name: string | null;
  university_chosen_at: Date | null;
  student_number: string | null;
  avatar_url: string | null;
  platform_role: PlatformRole;
  created_at: Date;
}

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    university: universityRef(row.university_id, row.university_name),
    studentNumber: row.student_number,
    avatarUrl: row.avatar_url,
    platformRole: row.platform_role,
    createdAt: row.created_at.toISOString(),
  };
}

async function issueTokens(
  deps: AuthDeps,
  db: Database,
  user: { id: string; platform_role: PlatformRole },
  deviceId: string | null | undefined,
  familyId: string = randomUUID(),
): Promise<{ refreshTokenId: string; tokens: TokenPair }> {
  const refresh = newRefreshToken();
  const row = await db
    .insertInto('refresh_tokens')
    .values({
      user_id: user.id,
      family_id: familyId,
      token_hash: refresh.hash,
      device_id: deviceId ?? null,
      expires_at: new Date(Date.now() + deps.refreshTokenTtlDays * 86_400_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    refreshTokenId: row.id,
    tokens: {
      accessToken: await deps.accessTokens.sign({ id: user.id, platformRole: user.platform_role }),
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: deps.accessTokens.ttlSeconds,
    },
  };
}

function revokeFamily(db: Database, familyId: string) {
  return db
    .updateTable('refresh_tokens')
    .set({ revoked_at: new Date() })
    .where('family_id', '=', familyId)
    .where('revoked_at', 'is', null)
    .execute();
}

export async function register(deps: AuthDeps, input: RegisterInput) {
  await assertUniversity(deps.db, input.universityId);
  // Hash outside the transaction: it is the slow part and needs no lock.
  const passwordHash = await hashPassword(input.password);

  return deps.db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({
        email: input.email.trim(),
        password_hash: passwordHash,
        full_name: input.fullName,
        university_id: input.universityId ?? null,
        // Picking one at sign-up starts its free week; "not listed" leaves the first pick free.
        university_chosen_at: input.universityId ? new Date() : null,
        student_number: input.studentNumber ?? null,
      })
      .returning(USER_COLUMNS)
      .executeTakeFirstOrThrow()
      .catch((err: unknown) => {
        throw isUniqueViolation(err, 'users_email_key')
          ? new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
          : err;
      });

    const { tokens } = await issueTokens(deps, trx, user, input.deviceId);
    return { user: toPublicUser(user), ...tokens };
  });
}

export async function login(deps: AuthDeps, input: LoginInput) {
  const user = await deps.db
    .selectFrom('users')
    .select([...USER_COLUMNS, 'password_hash'])
    .where('email', '=', input.email.trim())
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  // Same error for unknown email and wrong password, so accounts can't be enumerated.
  if (!(await verifyPassword(user?.password_hash, input.password)) || !user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const { tokens } = await issueTokens(deps, deps.db, user, input.deviceId);
  return { user: toPublicUser(user), ...tokens };
}

type RefreshOutcome = { kind: 'rotated'; tokens: TokenPair } | { kind: 'reused' } | { kind: 'invalid' };

/**
 * Rotating refresh tokens with reuse detection: every refresh retires the
 * presented token. If a retired token shows up again, a copy has leaked, so the
 * whole session (token family) is revoked and both holders must log in again.
 * Clients must therefore never run two refreshes in parallel.
 */
export async function refresh(deps: AuthDeps, refreshToken: string): Promise<TokenPair> {
  // The revocation must commit even though the request fails, so errors are
  // thrown only after the transaction has finished.
  const outcome = await deps.db.transaction().execute(async (trx): Promise<RefreshOutcome> => {
    const current = await trx
      .selectFrom('refresh_tokens')
      .select(['id', 'user_id', 'family_id', 'device_id', 'expires_at', 'revoked_at'])
      .where('token_hash', '=', hashRefreshToken(refreshToken))
      .forUpdate()
      .executeTakeFirst();

    if (!current) return { kind: 'invalid' };
    if (current.revoked_at) {
      await revokeFamily(trx, current.family_id);
      return { kind: 'reused' };
    }
    if (current.expires_at <= new Date()) return { kind: 'invalid' };

    const user = await trx
      .selectFrom('users')
      .select(['id', 'platform_role'])
      .where('id', '=', current.user_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) return { kind: 'invalid' };

    const next = await issueTokens(deps, trx, user, current.device_id, current.family_id);
    await trx
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date(), replaced_by: next.refreshTokenId })
      .where('id', '=', current.id)
      .execute();
    return { kind: 'rotated', tokens: next.tokens };
  });

  if (outcome.kind === 'reused') {
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'This session was revoked because an old refresh token was reused');
  }
  if (outcome.kind === 'invalid') {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }
  return outcome.tokens;
}

/** Ends this device's session. Unknown tokens are ignored so logout is idempotent. */
export async function logout(deps: AuthDeps, refreshToken: string): Promise<void> {
  const row = await deps.db
    .selectFrom('refresh_tokens')
    .select('family_id')
    .where('token_hash', '=', hashRefreshToken(refreshToken))
    .executeTakeFirst();
  if (row) await revokeFamily(deps.db, row.family_id);
}

/**
 * Deletes the account as KVKK and Google Play expect while keeping the clubs'
 * history honest. The row is anonymised rather than removed: name, email,
 * student number, university and password are wiped (the email is free for a
 * new account), every session ends and team memberships go. Seats held for
 * events that haven't started are given back. Past attendance, points and
 * scan logs stay in the clubs' numbers, tied to nobody.
 *
 * A wrong password is 403, not 401: clients treat 401 as "signed out".
 */
export async function deleteAccount(db: Database, userId: string, password: string): Promise<void> {
  const user = await db
    .selectFrom('users')
    .select('password_hash')
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Account no longer exists');
  if (!(await verifyPassword(user.password_hash, password))) {
    throw new AppError(403, 'WRONG_PASSWORD', 'Password is incorrect');
  }

  await db.transaction().execute(async (trx) => {
    const now = new Date();
    const released = await trx
      .updateTable('tickets')
      .set({ status: 'cancelled', cancelled_at: now })
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .where('event_id', 'in', trx.selectFrom('events').select('id').where('starts_at', '>', now))
      .returning('ticket_type_id')
      .execute();
    const seatsPerType = new Map<string, number>();
    for (const { ticket_type_id } of released) {
      seatsPerType.set(ticket_type_id, (seatsPerType.get(ticket_type_id) ?? 0) + 1);
    }
    for (const [ticketTypeId, seats] of seatsPerType) {
      await trx
        .updateTable('ticket_types')
        .set((eb) => ({ issued_count: eb('issued_count', '-', seats) }))
        .where('id', '=', ticketTypeId)
        .execute();
    }

    await trx.updateTable('tickets').set({ bound_device_id: null }).where('user_id', '=', userId).execute();
    await trx.deleteFrom('organization_members').where('user_id', '=', userId).execute();
    await trx
      .updateTable('refresh_tokens')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
    await trx
      .updateTable('users')
      .set({
        email: `deleted-${userId}@deleted.invalid`,
        email_verified_at: null,
        password_hash: null,
        full_name: 'Silinmiş kullanıcı',
        student_number: null,
        university_id: null,
        university_chosen_at: null,
        avatar_url: null,
        deleted_at: now,
        updated_at: now,
      })
      .where('id', '=', userId)
      .execute();
  });
}

/** Changes what students may edit about themselves; for now, their university. */
/** Changes what students may edit about themselves; for now, their university (see universityLockedUntil). */
export async function updateProfile(db: Database, userId: string, patch: { universityId: number | null }) {
  await assertUniversity(db, patch.universityId);
  await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('users')
      .select(['university_id', 'university_chosen_at'])
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!current || current.university_id === patch.universityId) return;
    const lockedUntil = universityLockedUntil(current.university_chosen_at);
    if (lockedUntil) {
      throw new AppError(409, 'UNIVERSITY_LOCKED', 'Your university can be changed once a year', {
        until: lockedUntil.toISOString(),
      });
    }
    await trx
      .updateTable('users')
      .set({
        university_id: patch.universityId,
        university_chosen_at:
          patch.universityId === null && current.university_chosen_at === null
            ? null
            : nextUniversityChosenAt(current.university_chosen_at),
      })
      .where('id', '=', userId)
      .execute();
  });
  return getProfile(db, userId);
}

export async function getProfile(db: Database, userId: string) {
  const user = await db
    .selectFrom('users')
    .select(USER_COLUMNS)
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Account no longer exists');

  const memberships = await db
    .selectFrom('organization_members as m')
    .innerJoin('organizations as o', 'o.id', 'm.organization_id')
    .select(['o.id', 'o.slug', 'o.name', 'm.role'])
    .where('m.user_id', '=', userId)
    .orderBy('o.name')
    .execute();

  return {
    ...toPublicUser(user),
    universityLockedUntil: universityLockedUntil(user.university_chosen_at)?.toISOString() ?? null,
    memberships: memberships.map((m) => ({ organizationId: m.id, slug: m.slug, name: m.name, role: m.role })),
  };
}
