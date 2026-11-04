import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { bearer, createPublishedEvent, createTestDatabase, createUser, seedCheckIn, testConfig } from './helpers.js';

let db: Database;
let app: App;
let emailCounter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const PASSWORD = 'correct horse battery';

async function registerStudent() {
  const email = `leaving${++emailCounter}@uni.edu.tr`;
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: PASSWORD, fullName: 'Ayşe Yılmaz', university: 'ODTÜ', studentNumber: '2481234' },
  });
  expect(res.statusCode).toBe(201);
  const session = res.json();
  return { email, id: session.user.id as string, token: session.accessToken as string, refresh: session.refreshToken };
}

const deleteAccount = (token: string, password: string) =>
  app.inject({ method: 'DELETE', url: '/me', headers: bearer(token), payload: { password } });

describe('DELETE /me', () => {
  it('wipes personal data, ends sessions and gives seats back but keeps club history', async () => {
    const owner = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const student = await registerStudent();

    const claim = await app.inject({
      method: 'POST',
      url: `/events/${eventId}/tickets`,
      headers: bearer(student.token),
      payload: { ticketTypeId: ticketTypeIds[0] },
    });
    expect(claim.statusCode).toBe(201);
    await db
      .insertInto('organization_members')
      .values({ organization_id: orgId, user_id: student.id, role: 'scanner' })
      .execute();
    await seedCheckIn(db, { userId: student.id, orgId, staffId: owner.id, points: 3 });

    expect((await deleteAccount(student.token, PASSWORD)).statusCode).toBe(204);

    const row = await db.selectFrom('users').selectAll().where('id', '=', student.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      email: `deleted-${student.id}@deleted.invalid`,
      full_name: 'Silinmiş kullanıcı',
      password_hash: null,
      student_number: null,
      university: null,
    });
    expect(row.deleted_at).not.toBeNull();

    // Signed out everywhere: the profile, the refresh token and the old password all fail.
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(student.token) })).statusCode).toBe(401);
    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: student.refresh },
    });
    expect(refresh.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: student.email, password: PASSWORD },
    });
    expect(login.json().code).toBe('INVALID_CREDENTIALS');

    // The upcoming seat is free again; the team membership is gone.
    const type = await db
      .selectFrom('ticket_types')
      .select('issued_count')
      .where('id', '=', ticketTypeIds[0] ?? '')
      .executeTakeFirstOrThrow();
    expect(type.issued_count).toBe(0);
    const memberships = await db.selectFrom('organization_members').where('user_id', '=', student.id).execute();
    expect(memberships).toEqual([]);

    // The club's history stays, anonymously.
    const balance = await db
      .selectFrom('point_balances')
      .select('lifetime_earned')
      .where('user_id', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(balance.lifetime_earned).toBe(3);
    const checkIns = await db.selectFrom('check_ins').where('user_id', '=', student.id).execute();
    expect(checkIns).toHaveLength(1);

    // And the email can open a new account.
    const again = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: student.email, password: PASSWORD, fullName: 'Ayşe Yılmaz' },
    });
    expect(again.statusCode).toBe(201);
  });

  it('refuses a wrong password with 403, so the app does not sign the person out', async () => {
    const student = await registerStudent();
    const res = await deleteAccount(student.token, 'not my password');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('WRONG_PASSWORD');

    const row = await db
      .selectFrom('users')
      .select('deleted_at')
      .where('id', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(row.deleted_at).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(student.token) })).statusCode).toBe(200);
  });

  it('needs a signed-in user', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/me', payload: { password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });
});
