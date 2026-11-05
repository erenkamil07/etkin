import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type App, buildApp } from '../src/app.js';
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../src/auth/tokens.js';
import type { Database } from '../src/db.js';
import { createTestDatabase, testConfig } from './helpers.js';

let db: Database;
let app: App;
let emailCounter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  // A route guarded by club role, standing in for the organizer endpoints of T1.4.
  app.get(
    '/test/orgs/:orgId/manage',
    {
      onRequest: app.authenticate,
      preHandler: app.requireOrgRole('organizer'),
      schema: { params: z.object({ orgId: z.uuid() }) },
    },
    async () => ({ ok: true }),
  );
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const uniqueEmail = () => `student${++emailCounter}@uni.edu.tr`;

async function registerUser(overrides: Record<string, unknown> = {}) {
  const body = { email: uniqueEmail(), password: 'correct horse battery', fullName: 'Ayşe Yılmaz', ...overrides };
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: body });
  expect(res.statusCode).toBe(201);
  return { ...res.json(), password: body.password };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('register', () => {
  it('creates the account, starts a session and stores an argon2id hash', async () => {
    const odtu = await db
      .selectFrom('universities')
      .select('id')
      .where('name', '=', 'Orta Doğu Teknik Üniversitesi')
      .executeTakeFirstOrThrow();
    const session = await registerUser({ universityId: odtu.id, studentNumber: '2481234' });

    expect(session).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        fullName: 'Ayşe Yılmaz',
        university: { id: odtu.id, name: 'Orta Doğu Teknik Üniversitesi' },
        studentNumber: '2481234',
        platformRole: 'user',
      },
    });
    expect(session.user).not.toHaveProperty('passwordHash');

    const row = await db
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', session.user.id)
      .executeTakeFirstOrThrow();
    expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { user } = await registerUser();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: user.email.toUpperCase(), password: 'another password', fullName: 'Copy Cat' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('EMAIL_TAKEN');
  });

  it('validates the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'short', fullName: 'A' },
    });
    expect(res.statusCode).toBe(400);
    expect(
      res
        .json()
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(['email', 'fullName', 'password']);
  });
});

describe('login', () => {
  it('returns a session for the right password', async () => {
    const { user, password } = await registerUser();
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const { user } = await registerUser();
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'wrong password' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@uni.edu.tr', password: 'wrong password' },
    });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS', detail: 'Email or password is incorrect' });
    }
  });

  it('rate limits password guessing on one account', async () => {
    const { user } = await registerUser();
    const attempt = () =>
      app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: 'guess' } });

    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();

    // Another student behind the same campus IP is unaffected.
    const other = await registerUser();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: other.user.email, password: other.password },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('access tokens', () => {
  it('lets the holder read their profile and club roles', async () => {
    const { user, accessToken } = await registerUser();
    const org = await db
      .insertInto('organizations')
      .values({ slug: 'ieee-odtu', name: 'IEEE ODTÜ' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('organization_members')
      .values({ organization_id: org.id, user_id: user.id, role: 'organizer' })
      .execute();

    const res = await app.inject({ method: 'GET', url: '/me', headers: bearer(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: user.id,
      memberships: [{ organizationId: org.id, slug: 'ieee-odtu', name: 'IEEE ODTÜ', role: 'organizer' }],
    });
  });

  it('requires a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('rejects tampered tokens and tokens signed with another key', async () => {
    const { accessToken, user } = await registerUser();
    const tampered = accessToken.slice(0, -2) + (accessToken.endsWith('A') ? 'BB' : 'AA');
    const forged = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('an-attacker-guessed-secret-of-32-chars'));

    for (const token of [tampered, forged, 'not-a-jwt']) {
      const res = await app.inject({ method: 'GET', url: '/me', headers: bearer(token) });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('INVALID_TOKEN');
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    }
  });

  it('tells the client when to refresh', async () => {
    const { user } = await registerUser();
    const expired = await new SignJWT({ role: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(testConfig.JWT_ACCESS_SECRET));

    const res = await app.inject({ method: 'GET', url: '/me', headers: bearer(expired) });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('TOKEN_EXPIRED');
  });
});

describe('refresh tokens', () => {
  const refreshWith = (refreshToken: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

  it('rotates: each refresh returns a new pair and retires the old token', async () => {
    const { refreshToken } = await registerUser();
    const first = await refreshWith(refreshToken);
    expect(first.statusCode).toBe(200);
    expect(first.json().refreshToken).not.toBe(refreshToken);

    const second = await refreshWith(first.json().refreshToken);
    expect(second.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/me', headers: bearer(second.json().accessToken) });
    expect(me.statusCode).toBe(200);
  });

  it('revokes the whole session when a retired token is replayed', async () => {
    const { refreshToken: stolen } = await registerUser();
    const legit = (await refreshWith(stolen)).json().refreshToken;

    const replay = await refreshWith(stolen);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate holder's newer token died with the family.
    const afterwards = await refreshWith(legit);
    expect(afterwards.statusCode).toBe(401);
    expect(afterwards.json().code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('rejects unknown and expired tokens', async () => {
    const unknown = await refreshWith('x'.repeat(43));
    expect(unknown.json().code).toBe('INVALID_REFRESH_TOKEN');

    const { refreshToken, user } = await registerUser();
    await db
      .updateTable('refresh_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', user.id)
      .execute();
    const expired = await refreshWith(refreshToken);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('logout ends the session and is idempotent', async () => {
    const { refreshToken } = await registerUser();
    const logout = () => app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken } });

    expect((await logout()).statusCode).toBe(204);
    expect((await logout()).statusCode).toBe(204);
    expect((await refreshWith(refreshToken)).statusCode).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const { refreshToken, user } = await registerUser();
    const rows = await db.selectFrom('refresh_tokens').select('token_hash').where('user_id', '=', user.id).execute();
    expect(rows).toHaveLength(1);
    const stored = Buffer.from(rows[0]?.token_hash ?? []);
    expect(stored.toString('base64url')).not.toBe(refreshToken);
    expect(stored).toHaveLength(32);
  });
});

describe('club roles', () => {
  let orgId: string;
  const member = async (role: 'owner' | 'organizer' | 'scanner' | null) => {
    const { user, accessToken } = await registerUser();
    if (role)
      await db.insertInto('organization_members').values({ organization_id: orgId, user_id: user.id, role }).execute();
    return { user, accessToken };
  };
  const manage = (token: string, id = orgId) =>
    app.inject({ method: 'GET', url: `/test/orgs/${id}/manage`, headers: bearer(token) });

  beforeAll(async () => {
    orgId = (
      await db
        .insertInto('organizations')
        .values({ slug: 'acm-itu', name: 'ACM İTÜ' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  it('allows the required role and anything above it', async () => {
    for (const role of ['organizer', 'owner'] as const) {
      expect((await manage((await member(role)).accessToken)).statusCode).toBe(200);
    }
  });

  it('forbids lower roles, outsiders and members of other clubs', async () => {
    const scanner = await member('scanner');
    const outsider = await member(null);
    for (const { accessToken } of [scanner, outsider]) {
      const res = await manage(accessToken);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    }

    const otherOrg = await db
      .insertInto('organizations')
      .values({ slug: 'gdg-boun', name: 'GDG Boğaziçi' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const organizerHere = await member('organizer');
    expect((await manage(organizerHere.accessToken, otherOrg.id)).statusCode).toBe(403);
  });

  it('lets platform admins through everywhere', async () => {
    const { user, password } = await registerUser();
    await db.updateTable('users').set({ platform_role: 'admin' }).where('id', '=', user.id).execute();
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password } });
    expect((await manage(login.json().accessToken)).statusCode).toBe(200);
  });
});
