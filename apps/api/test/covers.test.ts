import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import { cleanJpeg, NotAJpegError } from '../src/covers/jpeg.js';
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

const segment = (marker: number, payload: Buffer) => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
};

/** A JPEG's segment structure (the parser never decodes pixels), optionally with GPS in its EXIF. */
function jpeg({ width = 1200, height = 1697, gps = false, padding = 0 } = {}) {
  const frame = Buffer.alloc(15);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    gps ? segment(0xe1, Buffer.from('Exif\0\0GPSLatitude=36.78;GPSLongitude=34.53', 'latin1')) : Buffer.alloc(0),
    segment(0xfe, Buffer.from('taken on a phone')),
    segment(0xc0, frame),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from('compressed-image-data'),
    Buffer.alloc(padding),
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe('cleanJpeg', () => {
  it('reads the size and drops EXIF, XMP and comments but keeps the image', () => {
    const { data, width, height } = cleanJpeg(jpeg({ width: 800, height: 600, gps: true }));
    expect({ width, height }).toEqual({ width: 800, height: 600 });
    expect(data.includes('GPSLatitude')).toBe(false);
    expect(data.includes('taken on a phone')).toBe(false);
    expect(data.includes('JFIF')).toBe(true);
    expect(data.includes('compressed-image-data')).toBe(true);
  });

  it('refuses anything that is not a JPEG', () => {
    expect(() => cleanJpeg(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toThrow(NotAJpegError);
    expect(() => cleanJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]))).toThrow(NotAJpegError);
  });
});

describe('event posters', () => {
  const upload = (token: string, orgId: string, eventId: string, body: Buffer, type = 'image/jpeg') =>
    app.inject({
      method: 'PUT',
      url: `/orgs/${orgId}/events/${eventId}/cover`,
      headers: { ...bearer(token), 'content-type': type },
      payload: body,
    });

  it('are stored without location data and served for good to anyone, including other sites', async () => {
    const owner = await createUser(db);
    const { orgId, eventId } = await createPublishedEvent(app, owner);
    const res = await upload(owner.token, orgId, eventId, jpeg({ gps: true }));
    expect(res.statusCode).toBe(200);
    const cover = res.json();
    expect(cover).toEqual({ url: expect.stringMatching(`^/events/${eventId}/cover\\?v=`), width: 1200, height: 1697 });

    const image = await app.inject({ method: 'GET', url: cover.url });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(image.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(image.rawPayload.includes('GPSLatitude')).toBe(false);
    expect(image.rawPayload.includes('compressed-image-data')).toBe(true);
    // Without the current version, only a short cache: the poster may change.
    const unversioned = await app.inject({ method: 'GET', url: `/events/${eventId}/cover` });
    expect(unversioned.headers['cache-control']).toBe('public, max-age=300');

    const page = (await app.inject({ method: 'GET', url: `/events/${eventId}` })).json();
    expect(page.cover).toEqual(cover);
    const feed = (await app.inject({ method: 'GET', url: `/events?orgId=${orgId}` })).json();
    expect(feed.items[0].cover).toEqual(cover);

    const replaced = (await upload(owner.token, orgId, eventId, jpeg({ width: 1000, height: 1000 }))).json();
    expect(replaced.url).not.toBe(cover.url);
    expect(replaced).toMatchObject({ width: 1000, height: 1000 });
  });

  it('take JPEGs up to 1.5 MB only', async () => {
    const owner = await createUser(db);
    const { orgId, eventId } = await createPublishedEvent(app, owner);
    const png = Buffer.from('\x89PNG\r\n\x1a\n0000', 'latin1');
    expect((await upload(owner.token, orgId, eventId, png)).json().code).toBe('UNSUPPORTED_IMAGE');
    expect((await upload(owner.token, orgId, eventId, png, 'image/png')).statusCode).toBe(415);
    expect((await upload(owner.token, orgId, eventId, jpeg({ padding: 1_600_000 }))).statusCode).toBe(413);
  });

  it("are for the club's organizers, on events still open to change", async () => {
    const owner = await createUser(db);
    const scanner = await createUser(db);
    const stranger = await createUser(db);
    const { orgId, eventId } = await createPublishedEvent(app, owner);
    const theirs = await createPublishedEvent(app, stranger);
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: bearer(owner.token),
      payload: { email: scanner.email, role: 'scanner' },
    });
    expect((await upload(scanner.token, orgId, eventId, jpeg())).statusCode).toBe(403);
    expect((await upload(owner.token, orgId, theirs.eventId, jpeg())).statusCode).toBe(404);

    await app.inject({ method: 'POST', url: `/orgs/${orgId}/events/${eventId}/cancel`, headers: bearer(owner.token) });
    expect((await upload(owner.token, orgId, eventId, jpeg())).json().code).toBe('EVENT_NOT_EDITABLE');
  });

  it('can be removed by the club, and go when a moderator removes the event', async () => {
    const owner = await createUser(db);
    const admin = await createUser(db, 'admin');
    const { orgId, eventId } = await createPublishedEvent(app, owner);
    await upload(owner.token, orgId, eventId, jpeg());
    const removed = await app.inject({
      method: 'DELETE',
      url: `/orgs/${orgId}/events/${eventId}/cover`,
      headers: bearer(owner.token),
    });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/events/${eventId}/cover` })).json().code).toBe('COVER_NOT_FOUND');
    expect((await app.inject({ method: 'GET', url: `/events/${eventId}` })).json().cover).toBeNull();

    await upload(owner.token, orgId, eventId, jpeg());
    await app.inject({ method: 'POST', url: `/admin/events/${eventId}/remove`, headers: bearer(admin.token) });
    expect((await app.inject({ method: 'GET', url: `/events/${eventId}/cover` })).statusCode).toBe(404);
  });
});
