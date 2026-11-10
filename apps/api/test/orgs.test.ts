import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { bearer, CLUB_APPLICATION, createTestDatabase, createUser, testConfig } from './helpers.js';

let db: Database;
let app: App;
let slugCounter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

type User = Awaited<ReturnType<typeof createUser>>;

async function createOrg(owner: User, slug = `club-${++slugCounter}`) {
  const res = await app.inject({
    method: 'POST',
    url: '/orgs',
    headers: bearer(owner.token),
    payload: { slug, name: 'IEEE ODTÜ', description: 'Elektrik-elektronik topluluğu', ...CLUB_APPLICATION },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; slug: string; name: string; description: string };
}

const setRole = (orgId: string, by: User, email: string, role: string) =>
  app.inject({ method: 'POST', url: `/orgs/${orgId}/members`, headers: bearer(by.token), payload: { email, role } });

const removeMember = (orgId: string, by: User, userId: string) =>
  app.inject({ method: 'DELETE', url: `/orgs/${orgId}/members/${userId}`, headers: bearer(by.token) });

async function team() {
  const owner = await createUser(db);
  const org = await createOrg(owner);
  const organizer = await createUser(db);
  const scanner = await createUser(db);
  expect((await setRole(org.id, owner, organizer.email, 'organizer')).statusCode).toBe(200);
  expect((await setRole(org.id, owner, scanner.email, 'scanner')).statusCode).toBe(200);
  return { org, owner, organizer, scanner };
}

describe('clubs', () => {
  it('creates a club and makes the creator its owner', async () => {
    const owner = await createUser(db);
    const org = await createOrg(owner, 'ieee-odtu');
    expect(org).toMatchObject({ slug: 'ieee-odtu', name: 'IEEE ODTÜ' });

    const publicView = await app.inject({ method: 'GET', url: `/orgs/${org.id}` });
    expect(publicView.statusCode).toBe(200);
    expect(publicView.json()).toEqual(org);

    const members = await app.inject({ method: 'GET', url: `/orgs/${org.id}/members`, headers: bearer(owner.token) });
    expect(members.json()).toEqual([expect.objectContaining({ userId: owner.id, role: 'owner' })]);
  });

  it('rejects taken and malformed slugs', async () => {
    await createOrg(await createUser(db), 'acm-itu');
    const owner = await createUser(db);
    const taken = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: bearer(owner.token),
      payload: { slug: 'acm-itu', name: 'Copy', ...CLUB_APPLICATION },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('SLUG_TAKEN');

    const malformed = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: bearer(owner.token),
      payload: { slug: 'Bad Slug!', name: 'Bad', ...CLUB_APPLICATION },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().errors[0].path).toBe('slug');
  });

  it('needs an account to create a club', async () => {
    const res = await app.inject({ method: 'POST', url: '/orgs', payload: { slug: 'anon-club', name: 'Anon' } });
    expect(res.statusCode).toBe(401);
  });

  it('answers 404 for an unknown club', async () => {
    const res = await app.inject({ method: 'GET', url: `/orgs/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('ORG_NOT_FOUND');
  });

  it('lets organizers edit the profile, changing only the fields sent', async () => {
    const { org, organizer, scanner } = await team();
    const edit = (user: User, payload: object) =>
      app.inject({ method: 'PATCH', url: `/orgs/${org.id}`, headers: bearer(user.token), payload });

    const res = await edit(organizer, { description: 'Yeni açıklama' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'IEEE ODTÜ', description: 'Yeni açıklama', slug: org.slug });

    expect((await edit(organizer, { description: null })).json().description).toBeNull();
    expect((await edit(scanner, { name: 'Hijacked' })).statusCode).toBe(403);
    expect((await edit(organizer, {})).statusCode).toBe(400);
  });
});

describe('team', () => {
  it('owners add registered users by email and change their roles', async () => {
    const owner = await createUser(db);
    const org = await createOrg(owner);
    const student = await createUser(db);

    const added = await setRole(org.id, owner, student.email.toUpperCase(), 'scanner');
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({ userId: student.id, role: 'scanner' });

    const promoted = await setRole(org.id, owner, student.email, 'organizer');
    expect(promoted.json().role).toBe('organizer');

    const members = await app.inject({ method: 'GET', url: `/orgs/${org.id}/members`, headers: bearer(owner.token) });
    expect(members.json().map((m: { role: string }) => m.role)).toEqual(['owner', 'organizer']);
  });

  it('asks unknown people to sign up first', async () => {
    const owner = await createUser(db);
    const org = await createOrg(owner);
    const res = await setRole(org.id, owner, 'not-registered@uni.edu.tr', 'scanner');
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('USER_NOT_FOUND');
  });

  it('lets only owners manage the team', async () => {
    const { org, organizer, scanner } = await team();
    const outsider = await createUser(db);
    expect((await setRole(org.id, organizer, outsider.email, 'scanner')).statusCode).toBe(403);
    expect((await removeMember(org.id, organizer, scanner.id)).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: `/orgs/${org.id}/members`, headers: bearer(scanner.token) })).statusCode,
    ).toBe(403);
  });

  it('never leaves a club without an owner', async () => {
    const { org, owner, organizer } = await team();

    const demoteSelf = await setRole(org.id, owner, owner.email, 'organizer');
    expect(demoteSelf.statusCode).toBe(409);
    expect(demoteSelf.json().code).toBe('LAST_OWNER');
    expect((await removeMember(org.id, owner, owner.id)).json().code).toBe('LAST_OWNER');

    await setRole(org.id, owner, organizer.email, 'owner');
    expect((await removeMember(org.id, owner, owner.id)).statusCode).toBe(204);
  });

  it('lets members leave on their own', async () => {
    const { org, scanner } = await team();
    expect((await removeMember(org.id, scanner, scanner.id)).statusCode).toBe(204);
    expect((await removeMember(org.id, scanner, scanner.id)).statusCode).toBe(404);
  });
});
