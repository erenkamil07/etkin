import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import { looksAlike, verificationUrl } from '../src/applications/names.js';
import type { Database } from '../src/db.js';
import { bearer, CLUB_APPLICATION, createTestDatabase, createUser, testConfig } from './helpers.js';

let db: Database;
let app: App;
let admin: Awaited<ReturnType<typeof createUser>>;
let mersin: number;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
  admin = await createUser(db, 'admin');
  mersin = (
    await db.selectFrom('universities').select('id').where('name', '=', 'Mersin Üniversitesi').executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

type User = Awaited<ReturnType<typeof createUser>>;
let slugCounter = 0;

const apply = (user: User, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/orgs',
    headers: bearer(user.token),
    payload: { slug: `applied-${++slugCounter}`, name: 'Yazılım Topluluğu', ...CLUB_APPLICATION, ...payload },
  });

const queue = async () =>
  (await app.inject({ method: 'GET', url: '/admin/club-applications', headers: bearer(admin.token) })).json();

const decide = (orgId: string, action: 'approve' | 'reject', reason?: string) =>
  app.inject({
    method: 'POST',
    url: `/admin/club-applications/${orgId}/${action}`,
    headers: bearer(admin.token),
    ...(reason !== undefined && { payload: { reason } }),
  });

/** A draft with one ticket type, and the response to publishing it. */
async function tryToPublish(owner: User, orgId: string) {
  const headers = bearer(owner.token);
  const startsAt = Date.now() + 7 * 86_400_000;
  const event = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/events`,
    headers,
    payload: {
      title: 'Tanışma',
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 7_200_000).toISOString(),
    },
  });
  expect(event.statusCode).toBe(201);
  const base = `/orgs/${orgId}/events/${event.json().id}`;
  await app.inject({
    method: 'POST',
    url: `${base}/ticket-types`,
    headers,
    payload: { name: 'Standart', capacity: 10 },
  });
  return app.inject({ method: 'POST', url: `${base}/publish`, headers });
}

const myClubs = async (user: User) =>
  (await app.inject({ method: 'GET', url: '/me', headers: bearer(user.token) })).json().memberships;

describe('applying for a club', () => {
  it('waits for review: drafts are fine, publishing is not, and one application at a time', async () => {
    const owner = await createUser(db);
    const res = await apply(owner, { verificationLink: '@meuyazilim', applicationNote: 'Başkanıyım.' });
    expect(res.statusCode).toBe(201);
    const club = res.json();
    expect(club.status).toBe('pending');
    expect((await app.inject({ method: 'GET', url: `/orgs/${club.id}` })).json().status).toBe('pending');
    expect(await myClubs(owner)).toEqual([
      expect.objectContaining({ organizationId: club.id, role: 'owner', clubStatus: 'pending', reviewedAt: null }),
    ]);

    const application = await app.inject({
      method: 'GET',
      url: `/orgs/${club.id}/application`,
      headers: bearer(owner.token),
    });
    expect(application.json()).toMatchObject({
      status: 'pending',
      applicantRole: 'president',
      verificationUrl: 'https://instagram.com/meuyazilim',
      applicationNote: 'Başkanıyım.',
      rejectionReason: null,
    });

    const refused = await tryToPublish(owner, club.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('CLUB_NOT_APPROVED');

    const second = await apply(owner, { name: 'Başka Kulüp' });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('APPLICATION_PENDING');
  });

  it('needs a role and a link the admin can check', async () => {
    const owner = await createUser(db);
    for (const payload of [
      { applicantRole: undefined },
      { verificationLink: undefined },
      { verificationLink: 'javascript:alert(1)' },
      { verificationLink: 'not a link' },
      { applicantRole: 'king' },
    ]) {
      expect((await apply(owner, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    const page = await apply(owner, { verificationLink: 'kulup.mersin.edu.tr/yazilim' });
    const application = await app.inject({
      method: 'GET',
      url: `/orgs/${page.json().id}/application`,
      headers: bearer(owner.token),
    });
    expect(application.json().verificationUrl).toBe('https://kulup.mersin.edu.tr/yazilim');
  });

  it('shows the application to its owner only', async () => {
    const owner = await createUser(db);
    const organizer = await createUser(db);
    const club = (await apply(owner)).json();
    await app.inject({
      method: 'POST',
      url: `/orgs/${club.id}/members`,
      headers: bearer(owner.token),
      payload: { email: organizer.email, role: 'organizer' },
    });
    for (const method of ['GET', 'PUT'] as const) {
      const res = await app.inject({
        method,
        url: `/orgs/${club.id}/application`,
        headers: bearer(organizer.token),
        ...(method === 'PUT' && { payload: CLUB_APPLICATION }),
      });
      expect(res.statusCode, method).toBe(403);
    }
  });

  it('is approved straight away when a platform admin creates the club', async () => {
    const res = await apply(admin);
    expect(res.json().status).toBe('approved');
    expect((await tryToPublish(admin, res.json().id)).statusCode).toBe(200);
  });
});

describe('reviewing applications', () => {
  it('is for platform admins only', async () => {
    const user = await createUser(db);
    const club = (await apply(user)).json();
    for (const [method, url] of [
      ['GET', '/admin/club-applications'],
      ['POST', `/admin/club-applications/${club.id}/approve`],
      ['POST', `/admin/club-applications/${club.id}/reject`],
    ] as const) {
      const res = await app.inject({ method, url, headers: bearer(user.token), payload: { reason: 'Neden olmasın' } });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('lists who applied, how to check, and clubs with a similar name at the same university', async () => {
    const first = await createUser(db);
    const existing = (await apply(first, { name: 'Mersin Yazılım Kulübü', universityId: mersin })).json();
    await decide(existing.id, 'approve');
    await apply(await createUser(db), { name: 'Mersin Müzik Topluluğu', universityId: mersin });

    const applicant = await createUser(db);
    const club = (
      await apply(applicant, {
        name: 'MEÜ Yazılımcı Topluluğu',
        universityId: mersin,
        applicantRole: 'board_member',
        verificationLink: 'https://instagram.com/meu.yazilimci',
      })
    ).json();

    const entry = (await queue()).find((item: { club: { id: string } }) => item.club.id === club.id);
    expect(entry).toMatchObject({
      club: { name: 'MEÜ Yazılımcı Topluluğu', university: { id: mersin, name: 'Mersin Üniversitesi' } },
      applicant: { id: applicant.id, email: applicant.email },
      applicantRole: 'board_member',
      verificationUrl: 'https://instagram.com/meu.yazilimci',
      previousRejection: null,
    });
    // The music club shares only the city, which doesn't count.
    expect(entry.similarClubs).toEqual([{ id: existing.id, name: 'Mersin Yazılım Kulübü', status: 'approved' }]);
  });

  it('approves: the club can publish and its owner sees it', async () => {
    const owner = await createUser(db);
    const club = (await apply(owner)).json();
    expect((await decide(club.id, 'approve')).statusCode).toBe(204);
    expect((await tryToPublish(owner, club.id)).statusCode).toBe(200);
    expect((await myClubs(owner))[0]).toMatchObject({ clubStatus: 'approved', reviewedAt: expect.any(String) });
    expect((await queue()).some((item: { club: { id: string } }) => item.club.id === club.id)).toBe(false);

    const again = await decide(club.id, 'reject', 'Fikrimi değiştirdim');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('APPLICATION_NOT_PENDING');
  });

  it('refuses with a reason; the owner fixes the application and goes back in the queue', async () => {
    const owner = await createUser(db);
    const club = (await apply(owner)).json();
    expect((await decide(club.id, 'reject', '')).statusCode).toBe(400);
    expect((await decide(club.id, 'reject', 'Instagram hesabında adın geçmiyor.')).statusCode).toBe(204);

    const headers = bearer(owner.token);
    const refused = (await app.inject({ method: 'GET', url: `/orgs/${club.id}/application`, headers })).json();
    expect(refused).toMatchObject({ status: 'rejected', rejectionReason: 'Instagram hesabında adın geçmiyor.' });
    expect((await tryToPublish(owner, club.id)).json().code).toBe('CLUB_NOT_APPROVED');

    const again = await app.inject({
      method: 'PUT',
      url: `/orgs/${club.id}/application`,
      headers,
      payload: { ...CLUB_APPLICATION, verificationLink: '@gercekhesap', applicationNote: 'Yönetimde adım var.' },
    });
    expect(again.json()).toMatchObject({ status: 'pending', verificationUrl: 'https://instagram.com/gercekhesap' });
    const entry = (await queue()).find((item: { club: { id: string } }) => item.club.id === club.id);
    expect(entry.previousRejection).toBe('Instagram hesabında adın geçmiyor.');

    await decide(club.id, 'approve');
    const approved = await app.inject({
      method: 'PUT',
      url: `/orgs/${club.id}/application`,
      headers,
      payload: CLUB_APPLICATION,
    });
    expect(approved.json().code).toBe('CLUB_ALREADY_APPROVED');
  });
});

describe('application helpers', () => {
  it('reads Instagram accounts and web pages, and nothing else', () => {
    expect(verificationUrl('@meu_yazilim')).toBe('https://instagram.com/meu_yazilim');
    expect(verificationUrl(' meuyazilim ')).toBe('https://instagram.com/meuyazilim');
    expect(verificationUrl('instagram.com/meuyazilim')).toBe('https://instagram.com/meuyazilim');
    expect(verificationUrl('http://kulup.edu.tr')).toBe('http://kulup.edu.tr/');
    expect(verificationUrl('ftp://kulup.edu.tr')).toBeNull();
    expect(verificationUrl('https://user:pass@kulup.edu.tr')).toBeNull();
    expect(verificationUrl('iki kelime')).toBeNull();
  });

  it('spots names that look alike, ignoring common words and the city', () => {
    expect(looksAlike('Yazılım Kulübü', 'Mersin Üniversitesi Yazılımcı Topluluğu', 'Mersin Üniversitesi')).toBe(true);
    expect(looksAlike('IEEE Öğrenci Kolu', 'IEEE Computer Society', null)).toBe(true);
    expect(looksAlike('Mersin Müzik Topluluğu', 'Mersin Yazılım Kulübü', 'Mersin Üniversitesi')).toBe(false);
    expect(looksAlike('Kulüp', 'Topluluk', null)).toBe(false);
  });
});
