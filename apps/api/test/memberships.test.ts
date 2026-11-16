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

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

/** A signed-in student with a student number, ready to ask to join. */
async function student(studentNumber: string | null = '23430070037') {
  const user = await createUser(db);
  await db.updateTable('users').set({ student_number: studentNumber }).where('id', '=', user.id).execute();
  return user;
}

const join = (token: string, orgId: string) =>
  app.inject({ method: 'POST', url: `/orgs/${orgId}/membership`, headers: bearer(token) });
const decide = (token: string, orgId: string, userId: string, verdict: 'approve' | 'reject') =>
  app.inject({ method: 'POST', url: `/orgs/${orgId}/memberships/${userId}/${verdict}`, headers: bearer(token) });
const requests = (token: string, orgId: string, status = 'pending') =>
  app.inject({ method: 'GET', url: `/orgs/${orgId}/memberships?status=${status}`, headers: bearer(token) });
const me = async (token: string) => (await app.inject({ method: 'GET', url: '/me', headers: bearer(token) })).json();
const claim = (token: string, eventId: string, ticketTypeId: string) =>
  app.inject({ method: 'POST', url: `/events/${eventId}/tickets`, headers: bearer(token), payload: { ticketTypeId } });

describe('joining a club', () => {
  it('is a request the organizers answer, shown with the student number', async () => {
    const owner = await createUser(db);
    const { orgId } = await createPublishedEvent(app, owner);
    const ayse = await student('23430070001');

    const asked = await join(ayse.token, orgId);
    expect(asked.statusCode).toBe(200);
    expect(asked.json()).toMatchObject({ status: 'pending', decidedAt: null });
    // Asking twice changes nothing.
    expect((await join(ayse.token, orgId)).json().status).toBe('pending');

    const inbox = await requests(owner.token, orgId);
    expect(inbox.json()).toEqual([
      expect.objectContaining({ userId: ayse.id, studentNumber: '23430070001', status: 'pending' }),
    ]);
    expect((await me(owner.token)).memberships[0]).toMatchObject({ organizationId: orgId, pendingRequests: 1 });

    const approved = await decide(owner.token, orgId, ayse.id, 'approve');
    expect(approved.json()).toMatchObject({ status: 'approved', decidedAt: expect.any(String) });
    expect((await requests(owner.token, orgId)).json()).toEqual([]);
    expect((await requests(owner.token, orgId, 'approved')).json()).toHaveLength(1);
    expect((await me(owner.token)).memberships[0].pendingRequests).toBe(0);
    expect((await me(ayse.token)).clubs).toEqual([
      expect.objectContaining({ organizationId: orgId, name: 'Test Club', status: 'approved' }),
    ]);
    expect((await app.inject({ method: 'GET', url: `/orgs/${orgId}` })).json().memberCount).toBe(1);

    // A request already answered can't be answered again.
    const again = await decide(owner.token, orgId, ayse.id, 'reject');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('MEMBERSHIP_NOT_PENDING');
  });

  it('needs a student number, an approved club, and someone not already on the team', async () => {
    const owner = await createUser(db);
    const { orgId } = await createPublishedEvent(app, owner);

    const noNumber = await join((await student(null)).token, orgId);
    expect(noNumber.statusCode).toBe(409);
    expect(noNumber.json().code).toBe('STUDENT_NUMBER_REQUIRED');

    expect((await join(owner.token, orgId)).json().code).toBe('ALREADY_IN_TEAM');

    const applicant = await createUser(db);
    const pendingClub = await app.inject({
      method: 'POST',
      url: '/orgs',
      headers: bearer(applicant.token),
      payload: { slug: `waiting-${Date.now()}`, name: 'Waiting Club', ...CLUB_APPLICATION },
    });
    expect((await join((await student()).token, pendingClub.json().id)).json().code).toBe('CLUB_NOT_APPROVED');
  });

  it('can be refused, asked again, left, and withdrawn', async () => {
    const owner = await createUser(db);
    const { orgId } = await createPublishedEvent(app, owner);
    const mert = await student();

    await join(mert.token, orgId);
    expect((await decide(owner.token, orgId, mert.id, 'reject')).json().status).toBe('rejected');
    expect((await me(mert.token)).clubs[0].status).toBe('rejected');
    // After a refusal, asking again puts the request back in the queue.
    expect((await join(mert.token, orgId)).json()).toMatchObject({ status: 'pending', decidedAt: null });

    const leave = await app.inject({ method: 'DELETE', url: `/orgs/${orgId}/membership`, headers: bearer(mert.token) });
    expect(leave.statusCode).toBe(204);
    expect((await me(mert.token)).clubs).toEqual([]);
    const mine = await app.inject({ method: 'GET', url: `/orgs/${orgId}/membership`, headers: bearer(mert.token) });
    expect(mine.json()).toBeNull();

    const again = await app.inject({ method: 'DELETE', url: `/orgs/${orgId}/membership`, headers: bearer(mert.token) });
    expect(again.json().code).toBe('MEMBERSHIP_NOT_FOUND');
  });

  it('is answered by organizers only; they can also remove a member', async () => {
    const owner = await createUser(db);
    const { orgId } = await createPublishedEvent(app, owner);
    const scanner = await createUser(db);
    await db
      .insertInto('organization_members')
      .values({ organization_id: orgId, user_id: scanner.id, role: 'scanner' })
      .execute();
    const zeynep = await student();
    await join(zeynep.token, orgId);

    expect((await requests(scanner.token, orgId)).statusCode).toBe(403);
    expect((await decide(scanner.token, orgId, zeynep.id, 'approve')).statusCode).toBe(403);
    expect((await requests(zeynep.token, orgId)).statusCode).toBe(403);
    expect((await me(scanner.token)).memberships[0].pendingRequests).toBe(0);

    await decide(owner.token, orgId, zeynep.id, 'approve');
    const removed = await app.inject({
      method: 'DELETE',
      url: `/orgs/${orgId}/memberships/${zeynep.id}`,
      headers: bearer(owner.token),
    });
    expect(removed.statusCode).toBe(204);
    expect((await me(zeynep.token)).clubs).toEqual([]);
  });
});

describe('members-only events', () => {
  it('take approved members and the club team only', async () => {
    const owner = await createUser(db);
    const { orgId, eventId, ticketTypeIds } = await createPublishedEvent(app, owner, undefined, {
      event: { audience: 'members' },
    });
    const typeId = ticketTypeIds[0] as string;
    const event = await app.inject({ method: 'GET', url: `/events/${eventId}` });
    expect(event.json()).toMatchObject({ audience: 'members', universityOnly: false });

    const outsider = await student();
    const refused = await claim(outsider.token, eventId, typeId);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('MEMBERS_ONLY');

    // Waiting for an answer isn't enough.
    await join(outsider.token, orgId);
    expect((await claim(outsider.token, eventId, typeId)).json().code).toBe('MEMBERS_ONLY');

    await decide(owner.token, orgId, outsider.id, 'approve');
    expect((await claim(outsider.token, eventId, typeId)).statusCode).toBe(201);
    // The team always counts as members.
    expect((await claim(owner.token, eventId, typeId)).statusCode).toBe(201);
  });

  it('still read universityOnly from older apps', async () => {
    const owner = await createUser(db);
    const { orgId, eventId } = await createPublishedEvent(app, owner);
    const mersin = await db
      .selectFrom('universities')
      .select('id')
      .where('name', '=', 'Mersin Üniversitesi')
      .executeTakeFirstOrThrow();
    await app.inject({
      method: 'PATCH',
      url: `/orgs/${orgId}`,
      headers: bearer(owner.token),
      payload: { universityId: mersin.id },
    });

    const patch = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/orgs/${orgId}/events/${eventId}`, headers: bearer(owner.token), payload });
    expect((await patch({ universityOnly: true })).json()).toMatchObject({
      audience: 'university',
      universityOnly: true,
    });
    expect((await patch({ audience: 'members' })).json()).toMatchObject({ audience: 'members', universityOnly: false });
    expect((await patch({ universityOnly: false })).json().audience).toBe('everyone');
  });
});
