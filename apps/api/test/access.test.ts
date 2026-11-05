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

// Everything else needs a signed-in user. A new route lands here only on purpose.
const PUBLIC = new Set([
  'GET /health/live',
  'GET /health/ready',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /orgs/{orgId}',
  'GET /events',
  'GET /events/{eventId}',
  'GET /universities',
]);

const SOME_ID = '0190a000-0000-7000-8000-000000000000';

// A valid body for every write below, so requests get past validation and
// reach the role check (Fastify validates before preHandlers run).
const BODY: Record<string, Record<string, unknown>> = {
  PATCH_org: { name: 'Hijacked' },
  check_in: { qr: 'not-a-real-code', gate: 'A' },
  manual: { ticketId: SOME_ID, gate: 'A' },
  event: { title: 'Hijacked', startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T12:00:00Z' },
  ticket_type: { name: 'VIP', capacity: 5 },
  member: { email: 'someone@uni.edu.tr', role: 'organizer' },
};
const bodyFor = (method: string, url: string): Record<string, unknown> | undefined => {
  if (url.endsWith('/check-ins/manual')) return BODY.manual;
  if (url.endsWith('/check-ins')) return BODY.check_in;
  if (url.endsWith('/ticket-types')) return BODY.ticket_type;
  if (url.endsWith('/members')) return BODY.member;
  if (method === 'PATCH' && url.includes('/events/')) return { title: 'Hijacked' };
  if (method === 'PATCH') return BODY.PATCH_org;
  if (method === 'POST' && url.endsWith('/events')) return BODY.event;
  return undefined;
};

describe('access control', () => {
  it('turns away every non-public route without a session', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json() as {
      paths: Record<string, Record<string, unknown>>;
    };
    const checked: string[] = [];
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const method of Object.keys(operations)) {
        const route = `${method.toUpperCase()} ${path}`;
        if (PUBLIC.has(route)) continue;
        const url = path.replace(/\{[^}]+\}/g, SOME_ID);
        const res = await app.inject({ method: method.toUpperCase() as 'GET', url, payload: {} });
        expect(res.statusCode, route).toBe(401);
        checked.push(route);
      }
    }
    // A guard against the spec silently shrinking (say, routes hidden from the docs).
    expect(checked.length).toBeGreaterThan(30);
  });

  it("keeps one club's team out of another club's events, stats and door", async () => {
    const ownerA = await createUser(db);
    const ownerB = await createUser(db);
    const a = await createPublishedEvent(app, ownerA);
    const b = await createPublishedEvent(app, ownerB);
    const asA = bearer(ownerA.token);

    // Through club B's own path: not on its team.
    for (const [method, url] of [
      ['GET', `/orgs/${b.orgId}/events`],
      ['GET', `/orgs/${b.orgId}/members`],
      ['PATCH', `/orgs/${b.orgId}`],
      ['GET', `/orgs/${b.orgId}/events/${b.eventId}/stats`],
      ['GET', `/orgs/${b.orgId}/events/${b.eventId}/attendees`],
      ['POST', `/orgs/${b.orgId}/events/${b.eventId}/cancel`],
      ['POST', `/orgs/${b.orgId}/events/${b.eventId}/check-ins`],
    ] as const) {
      const res = await app.inject({ method, url, headers: asA, payload: bodyFor(method, url) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }

    // Through club A's path with club B's event: the event isn't A's, so it doesn't exist there.
    for (const [method, url] of [
      ['GET', `/orgs/${a.orgId}/events/${b.eventId}/stats`],
      ['GET', `/orgs/${a.orgId}/events/${b.eventId}/attendees`],
      ['PATCH', `/orgs/${a.orgId}/events/${b.eventId}`],
      ['POST', `/orgs/${a.orgId}/events/${b.eventId}/cancel`],
      ['POST', `/orgs/${a.orgId}/events/${b.eventId}/ticket-types`],
    ] as const) {
      const res = await app.inject({ method, url, headers: asA, payload: bodyFor(method, url) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('keeps door scanners to the door', async () => {
    const owner = await createUser(db);
    const scanner = await createUser(db);
    const { orgId, eventId } = await createPublishedEvent(app, owner);
    await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/members`,
      headers: bearer(owner.token),
      payload: { email: scanner.email, role: 'scanner' },
    });
    const asScanner = bearer(scanner.token);
    for (const [method, url] of [
      ['GET', `/orgs/${orgId}/events/${eventId}/stats`],
      ['GET', `/orgs/${orgId}/events/${eventId}/attendees`],
      ['POST', `/orgs/${orgId}/events/${eventId}/check-ins/manual`],
      ['POST', `/orgs/${orgId}/events/${eventId}/cancel`],
      ['POST', `/orgs/${orgId}/events`],
      ['POST', `/orgs/${orgId}/members`],
    ] as const) {
      const res = await app.inject({ method, url, headers: asScanner, payload: bodyFor(method, url) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});
