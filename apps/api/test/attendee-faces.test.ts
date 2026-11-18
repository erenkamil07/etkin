import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { bearer, createPublishedEvent, createTestDatabase, createUser, testConfig } from './helpers.js';

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

/** A ticket holder with a profile photo, who has (or hasn't) chosen to show it on events. */
async function holder(eventId: string, ticketTypeId: string, { photo = true, shows = false } = {}) {
  const user = await createUser(db);
  if (photo) {
    await db
      .updateTable('users')
      .set({ avatar_url: `/users/${user.id}/avatar?v=abc`, show_photo_at_events: shows })
      .where('id', '=', user.id)
      .execute();
  }
  const claim = await app.inject({
    method: 'POST',
    url: `/events/${eventId}/tickets`,
    headers: bearer(user.token),
    payload: { ticketTypeId },
  });
  if (claim.statusCode !== 201) throw new Error(`claim failed: ${claim.body}`);
  return { ...user, ticketId: claim.json().id as string };
}

const attendees = async (eventId: string) =>
  (await app.inject({ method: 'GET', url: `/events/${eventId}` })).json().attendees;

describe('attendee faces', () => {
  it('count every holder but show only the photos people chose to show, at most three', async () => {
    const owner = await createUser(db);
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const typeId = ticketTypeIds[0] as string;

    await holder(eventId, typeId, { photo: false });
    const shy = await holder(eventId, typeId, { shows: false });
    expect(await attendees(eventId)).toEqual({ count: 2, photos: [] });

    const shown = [];
    for (let i = 0; i < 4; i++) shown.push(await holder(eventId, typeId, { shows: true }));
    const result = await attendees(eventId);
    expect(result.count).toBe(6);
    expect(result.photos).toHaveLength(3);
    // Latest first, and never the photo of someone who keeps it private.
    expect(result.photos[0]).toBe(`/users/${shown[3]?.id}/avatar?v=abc`);
    expect(result.photos).not.toContain(`/users/${shy.id}/avatar?v=abc`);

    // The feed carries the same.
    const feed = await app.inject({ method: 'GET', url: '/events?limit=50' });
    const card = feed.json().items.find((item: { id: string }) => item.id === eventId);
    expect(card.attendees).toEqual(result);
  });

  it('drop a holder who cancels', async () => {
    const owner = await createUser(db);
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner);
    const leaving = await holder(eventId, ticketTypeIds[0] as string, { shows: true });
    expect((await attendees(eventId)).photos).toHaveLength(1);

    await app.inject({ method: 'POST', url: `/tickets/${leaving.ticketId}/cancel`, headers: bearer(leaving.token) });
    expect(await attendees(eventId)).toEqual({ count: 0, photos: [] });
  });

  it('follow the setting on the profile, which starts off', async () => {
    const user = await createUser(db);
    const me = () => app.inject({ method: 'GET', url: '/me', headers: bearer(user.token) });
    expect((await me()).json().showPhotoAtEvents).toBe(false);

    const on = await app.inject({
      method: 'PATCH',
      url: '/me',
      headers: bearer(user.token),
      payload: { showPhotoAtEvents: true },
    });
    expect(on.json().showPhotoAtEvents).toBe(true);
    expect((await me()).json().showPhotoAtEvents).toBe(true);
  });
});
