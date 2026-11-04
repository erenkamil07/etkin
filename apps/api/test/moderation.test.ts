import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { REMOVED_TITLE } from '../src/moderation/service.js';
import {
  bearer,
  createPublishedEvent,
  createTestDatabase,
  createTicketHolder,
  createUser,
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

const report = (token: string, eventId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/events/${eventId}/reports`, headers: bearer(token), payload });

async function openReports(adminToken: string) {
  const res = await app.inject({ method: 'GET', url: '/admin/reports', headers: bearer(adminToken) });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    event: { id: string; title: string };
    reports: { reason: string; details: string | null }[];
  }[];
}

const forEvent = async (adminToken: string, eventId: string) =>
  (await openReports(adminToken)).find((entry) => entry.event.id === eventId);

describe('reporting an event', () => {
  it('files one report per person, which reporting again updates', async () => {
    const owner = await createUser(db);
    const admin = await createUser(db, 'admin');
    const student = await createUser(db);
    const { eventId } = await createPublishedEvent(app, owner);

    expect((await report(student.token, eventId, { reason: 'spam' })).statusCode).toBe(204);
    expect(
      (await report(student.token, eventId, { reason: 'misleading', details: '  Böyle bir etkinlik yok.  ' }))
        .statusCode,
    ).toBe(204);

    const entry = await forEvent(admin.token, eventId);
    expect(entry?.reports).toEqual([
      expect.objectContaining({ reason: 'misleading', details: 'Böyle bir etkinlik yok.' }),
    ]);
  });

  it('puts the most reported event first and keeps reporters anonymous', async () => {
    const owner = await createUser(db);
    const admin = await createUser(db, 'admin');
    const { eventId: quiet } = await createPublishedEvent(app, owner);
    const { eventId: loud } = await createPublishedEvent(app, owner);
    await report((await createUser(db)).token, quiet, { reason: 'other' });
    for (let i = 0; i < 2; i++) await report((await createUser(db)).token, loud, { reason: 'inappropriate' });

    const queue = await openReports(admin.token);
    const ids = queue.map((entry) => entry.event.id);
    expect(ids.indexOf(loud)).toBeLessThan(ids.indexOf(quiet));
    expect(JSON.stringify(queue)).not.toContain('reporter');
  });

  it('limits how often one person can report, not everyone behind their IP', async () => {
    const owner = await createUser(db);
    const { eventId } = await createPublishedEvent(app, owner);
    const busy = await createUser(db);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await report(busy.token, eventId, { reason: 'spam' })).statusCode);
    expect(statuses.slice(0, 10).every((status) => status === 204)).toBe(true);
    expect(statuses[10]).toBe(429);

    expect((await report((await createUser(db)).token, eventId, { reason: 'spam' })).statusCode).toBe(204);
  });

  it("can't report drafts, unknown events or without signing in, and checks the reason", async () => {
    const owner = await createUser(db);
    const student = await createUser(db);
    const orgId = (
      await app.inject({
        method: 'POST',
        url: '/orgs',
        headers: bearer(owner.token),
        payload: { slug: 'draft-club', name: 'Draft Club' },
      })
    ).json().id;
    const startsAt = Date.now() + 86_400_000;
    const draft = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/events`,
      headers: bearer(owner.token),
      payload: {
        title: 'Not out yet',
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(startsAt + 3_600_000).toISOString(),
      },
    });

    expect((await report(student.token, draft.json().id, { reason: 'spam' })).statusCode).toBe(404);
    expect((await report(student.token, '0190a000-0000-7000-8000-000000000000', { reason: 'spam' })).statusCode).toBe(
      404,
    );

    const { eventId } = await createPublishedEvent(app, owner);
    expect((await report(student.token, eventId, { reason: 'boring' })).statusCode).toBe(400);
    expect((await report(student.token, eventId, { reason: 'other', details: 'x'.repeat(1001) })).statusCode).toBe(400);
    const anonymous = await app.inject({
      method: 'POST',
      url: `/events/${eventId}/reports`,
      payload: { reason: 'spam' },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('reviewing reports', () => {
  it('is for platform admins only, club owners included', async () => {
    const owner = await createUser(db);
    const { eventId } = await createPublishedEvent(app, owner);
    const headers = bearer(owner.token);
    expect((await app.inject({ method: 'GET', url: '/admin/reports', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/admin/events/${eventId}/remove`, headers })).statusCode).toBe(
      403,
    );
    expect(
      (await app.inject({ method: 'POST', url: `/admin/events/${eventId}/dismiss-reports`, headers })).statusCode,
    ).toBe(403);
  });

  it('removing an event cancels it and its tickets, replaces its text and closes its reports', async () => {
    const owner = await createUser(db);
    const admin = await createUser(db, 'admin');
    const { eventId, ticketTypeIds } = await createPublishedEvent(app, owner, undefined, {
      event: {
        title: 'Offensive title',
        description: 'Offensive text',
        locationName: 'Somewhere',
        paymentInfo: 'Send money to this IBAN',
      },
    });
    const holder = await createTicketHolder(app, db, eventId, ticketTypeIds[0] as string);
    await report((await createUser(db)).token, eventId, { reason: 'inappropriate' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${eventId}/remove`,
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(204);

    const event = (await app.inject({ method: 'GET', url: `/events/${eventId}` })).json();
    expect(event).toMatchObject({ status: 'cancelled', title: REMOVED_TITLE, locationName: null, paymentInfo: null });
    expect(event.description).not.toContain('Offensive');
    const ticket = await db
      .selectFrom('tickets')
      .select('status')
      .where('id', '=', holder.ticketId)
      .executeTakeFirstOrThrow();
    expect(ticket.status).toBe('cancelled');
    const feed = (await app.inject({ method: 'GET', url: '/events?limit=50' })).json();
    expect(feed.items.map((item: { id: string }) => item.id)).not.toContain(eventId);
    expect(await forEvent(admin.token, eventId)).toBeUndefined();

    const resolved = await db
      .selectFrom('event_reports')
      .select(['resolution', 'resolved_by'])
      .where('event_id', '=', eventId)
      .execute();
    expect(resolved).toEqual([{ resolution: 'removed', resolved_by: admin.id }]);
  });

  it('removes events that already ended too, and 404s for unknown ones', async () => {
    const admin = await createUser(db, 'admin');
    const owner = await createUser(db);
    const { eventId } = await createPublishedEvent(app, owner);
    await db.updateTable('events').set({ status: 'completed' }).where('id', '=', eventId).execute();

    const headers = bearer(admin.token);
    expect((await app.inject({ method: 'POST', url: `/admin/events/${eventId}/remove`, headers })).statusCode).toBe(
      204,
    );
    const event = await db
      .selectFrom('events')
      .select(['status', 'title'])
      .where('id', '=', eventId)
      .executeTakeFirstOrThrow();
    expect(event).toEqual({ status: 'completed', title: REMOVED_TITLE });

    const unknown = await app.inject({
      method: 'POST',
      url: '/admin/events/0190a000-0000-7000-8000-000000000000/remove',
      headers,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('dismissing closes the reports and leaves the event alone; new reports open again', async () => {
    const owner = await createUser(db);
    const admin = await createUser(db, 'admin');
    const student = await createUser(db);
    const { eventId } = await createPublishedEvent(app, owner, undefined, { event: { title: 'Perfectly fine' } });
    await report(student.token, eventId, { reason: 'spam' });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/events/${eventId}/dismiss-reports`,
      headers: bearer(admin.token),
    });
    expect(res.statusCode).toBe(204);
    expect(await forEvent(admin.token, eventId)).toBeUndefined();
    const event = (await app.inject({ method: 'GET', url: `/events/${eventId}` })).json();
    expect(event).toMatchObject({ status: 'published', title: 'Perfectly fine' });

    expect((await report(student.token, eventId, { reason: 'other' })).statusCode).toBe(204);
    expect((await forEvent(admin.token, eventId))?.reports).toHaveLength(1);
  });
});
