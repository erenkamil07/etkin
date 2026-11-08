import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import {
  bearer,
  createPublishedEvent,
  createTestDatabase,
  createTicketHolder,
  createUser,
  fakeJpeg,
  testConfig,
} from './helpers.js';

let db: Database;
let app: App;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

const me = async (token: string) => (await app.inject({ method: 'GET', url: '/me', headers: bearer(token) })).json();
const patchMe = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/me', headers: bearer(token), payload });
const setPhoto = (token: string, body: Buffer) =>
  app.inject({
    method: 'PUT',
    url: '/me/avatar',
    headers: { ...bearer(token), 'content-type': 'image/jpeg' },
    payload: body,
  });

describe('editing your profile', () => {
  it('changes your name and student number, and can clear the number', async () => {
    const user = await createUser(db);
    const res = await patchMe(user.token, { fullName: '  Ayşe Yılmaz  ', studentNumber: '2481234' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fullName: 'Ayşe Yılmaz', studentNumber: '2481234' });
    expect((await patchMe(user.token, { studentNumber: null })).json().studentNumber).toBeNull();
    expect((await me(user.token)).fullName).toBe('Ayşe Yılmaz');
  });

  it('needs something to change, and a real name', async () => {
    const user = await createUser(db);
    expect((await patchMe(user.token, {})).statusCode).toBe(400);
    expect((await patchMe(user.token, { fullName: 'A' })).statusCode).toBe(400);
  });
});

describe('profile photo', () => {
  it('is stored without metadata and reaches the door with the ticket holder', async () => {
    const owner = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const holder = await createTicketHolder(app, db, eventId, ticketTypeIds[0] as string);

    const res = await setPhoto(holder.user.token, fakeJpeg({ width: 400, height: 400, gps: true }));
    expect(res.statusCode).toBe(200);
    const { avatarUrl } = res.json();
    expect(avatarUrl.startsWith(`/users/${holder.user.id}/avatar?v=`)).toBe(true);
    expect((await me(holder.user.token)).avatarUrl).toBe(avatarUrl);

    const photo = await app.inject({ method: 'GET', url: avatarUrl });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.rawPayload.includes('GPSLatitude')).toBe(false);

    const attendees = await app.inject({
      method: 'GET',
      url: `/orgs/${orgId}/events/${eventId}/attendees`,
      headers: bearer(owner.token),
    });
    expect(attendees.json()[0]).toMatchObject({ avatarUrl });
  });

  it("can't be fetched without the current version", async () => {
    const user = await createUser(db);
    const { avatarUrl } = (await setPhoto(user.token, fakeJpeg())).json();
    expect((await app.inject({ method: 'GET', url: `/users/${user.id}/avatar?v=guess` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/users/${user.id}/avatar` })).statusCode).toBe(400);

    const replaced = (await setPhoto(user.token, fakeJpeg({ width: 300, height: 300 }))).json().avatarUrl;
    expect(replaced).not.toBe(avatarUrl);
    expect((await app.inject({ method: 'GET', url: avatarUrl })).statusCode).toBe(404);
  });

  it('can be removed, takes JPEG only, and goes with the account', async () => {
    const user = await createUser(db);
    expect((await setPhoto(user.token, Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).json().code).toBe(
      'UNSUPPORTED_IMAGE',
    );

    const first = (await setPhoto(user.token, fakeJpeg())).json().avatarUrl;
    const removed = await app.inject({ method: 'DELETE', url: '/me/avatar', headers: bearer(user.token) });
    expect(removed.statusCode).toBe(204);
    expect((await me(user.token)).avatarUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: first })).statusCode).toBe(404);

    const register = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'photo-leaver@uni.edu.tr', password: 'correct horse battery', fullName: 'Ali Veli' },
    });
    const session = register.json();
    const kept = (await setPhoto(session.accessToken, fakeJpeg())).json().avatarUrl;
    await app.inject({
      method: 'DELETE',
      url: '/me',
      headers: bearer(session.accessToken),
      payload: { password: 'correct horse battery' },
    });
    expect((await app.inject({ method: 'GET', url: kept })).statusCode).toBe(404);
  });
});
