import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import {
  bearer,
  CLUB_APPLICATION,
  createPublishedEvent,
  createTestDatabase,
  createUser,
  testConfig,
} from './helpers.js';

let db: Database;
let app: App;
let mersin: number;
let odtu: number;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  const id = async (name: string) =>
    (await db.selectFrom('universities').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
  mersin = await id('Mersin Üniversitesi');
  odtu = await id('Orta Doğu Teknik Üniversitesi');
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('GET /universities', () => {
  it('lists every university once, in Turkish alphabetical order, cacheable', async () => {
    const res = await app.inject({ method: 'GET', url: '/universities' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    const list: { id: number; name: string; city: string }[] = res.json();
    expect(list.length).toBeGreaterThan(200);
    expect(list).toContainEqual({ id: mersin, name: 'Mersin Üniversitesi', city: 'Mersin' });
    const names = list.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'tr')));
    // Turkish order: Ç after C, İ after I, Ş after S.
    expect(names.indexOf('Çukurova Üniversitesi')).toBeGreaterThan(names.indexOf('Cumhuriyet Üniversitesi'));
  });
});

describe('your university', () => {
  it('can be changed or cleared, and only to one from the list', async () => {
    const student = await createUser(db);
    const change = (universityId: number | null) =>
      app.inject({ method: 'PATCH', url: '/me', headers: bearer(student.token), payload: { universityId } });

    expect((await change(mersin)).json().university).toEqual({ id: mersin, name: 'Mersin Üniversitesi' });
    expect((await app.inject({ method: 'GET', url: '/me', headers: bearer(student.token) })).json().university).toEqual(
      {
        id: mersin,
        name: 'Mersin Üniversitesi',
      },
    );
    expect((await change(null)).json().university).toBeNull();

    const unknown = await change(30_000);
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('UNKNOWN_UNIVERSITY');
  });

  it('is refused at sign-up when it is not in the list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'nowhere@uni.edu.tr',
        password: 'correct horse battery',
        fullName: 'Ali Veli',
        universityId: 30_000,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('UNKNOWN_UNIVERSITY');
  });
});

describe('clubs and the feed', () => {
  it("shows a campus's events to its students, and everything when no university is asked for", async () => {
    const owner = await createUser(db);
    const mersinEvent = await createPublishedEvent(app, owner);
    const odtuEvent = await createPublishedEvent(app, owner);
    const setUniversity = (orgId: string, universityId: number | null) =>
      app.inject({ method: 'PATCH', url: `/orgs/${orgId}`, headers: bearer(owner.token), payload: { universityId } });

    const patched = await setUniversity(mersinEvent.orgId, mersin);
    expect(patched.json().university).toEqual({ id: mersin, name: 'Mersin Üniversitesi' });
    await setUniversity(odtuEvent.orgId, odtu);

    const feed = async (query: string) =>
      ((await app.inject({ method: 'GET', url: `/events?limit=50${query}` })).json().items as { id: string }[]).map(
        (item) => item.id,
      );
    const mersinFeed = await feed(`&universityId=${mersin}`);
    expect(mersinFeed).toContain(mersinEvent.eventId);
    expect(mersinFeed).not.toContain(odtuEvent.eventId);
    expect(await feed('')).toEqual(expect.arrayContaining([mersinEvent.eventId, odtuEvent.eventId]));

    const event = (await app.inject({ method: 'GET', url: `/events/${mersinEvent.eventId}` })).json();
    expect(event.organization.university).toEqual({ id: mersin, name: 'Mersin Üniversitesi' });
  });

  it('takes the university when the club is created, from the list only', async () => {
    const owner = await createUser(db);
    const create = (slug: string, universityId: number) =>
      app.inject({
        method: 'POST',
        url: '/orgs',
        headers: bearer(owner.token),
        payload: { slug, name: 'Yazılım Topluluğu', universityId, ...CLUB_APPLICATION },
      });
    expect((await create('meu-yazilim', mersin)).json().university).toEqual({
      id: mersin,
      name: 'Mersin Üniversitesi',
    });
    expect((await create('nowhere-club', 30_000)).json().code).toBe('UNKNOWN_UNIVERSITY');
  });
});
