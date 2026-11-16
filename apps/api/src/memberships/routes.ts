import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import { BEARER, DateTimeOutput, OrgParams } from '../schemas.js';
import { UniversityRef } from '../universities/routes.js';
import {
  decideMembership,
  getMyMembership,
  leaveClub,
  listMemberships,
  removeClubMember,
  requestMembership,
} from './service.js';

export const MembershipStatus = z.enum(['pending', 'approved', 'rejected']);

export const MyMembership = z.object({
  status: MembershipStatus,
  requestedAt: DateTimeOutput,
  decidedAt: DateTimeOutput.nullable(),
});

const ClubMember = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  studentNumber: z.string().nullable().describe('To check the request against the club’s own member list'),
  university: UniversityRef.nullable(),
  status: MembershipStatus,
  requestedAt: DateTimeOutput,
  decidedAt: DateTimeOutput.nullable(),
});

const MemberParams = OrgParams.extend({ userId: z.uuid() });

export const membershipRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  // --- the student's side ------------------------------------------------------

  app.get(
    '/orgs/:orgId/membership',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['memberships'],
        summary: 'Your membership of this club; null when you never asked or have left',
        security: BEARER,
        params: OrgParams,
        response: { 200: MyMembership.nullable() },
      },
    },
    async (request) => getMyMembership(db, request.params.orgId, currentUser(request).id),
  );

  app.post(
    '/orgs/:orgId/membership',
    {
      onRequest: app.authenticate,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (request) => request.user?.id ?? request.ip,
        },
      },
      schema: {
        tags: ['memberships'],
        summary:
          'Ask to join the club; needs a student number on your profile. Asking again after a refusal re-opens it',
        security: BEARER,
        params: OrgParams,
        response: { 200: MyMembership },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const membership = await requestMembership(db, request.params.orgId, user.id);
      request.log.info({ orgId: request.params.orgId, status: membership.status }, 'club membership requested');
      return membership;
    },
  );

  app.delete(
    '/orgs/:orgId/membership',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['memberships'],
        summary: 'Leave the club, or withdraw your request',
        security: BEARER,
        params: OrgParams,
      },
    },
    async (request, reply) => {
      await leaveClub(db, request.params.orgId, currentUser(request).id);
      return reply.status(204).send();
    },
  );

  // --- the club's organizers -----------------------------------------------------

  const organizer = { onRequest: app.authenticate, preHandler: app.requireOrgRole('organizer') };

  app.get(
    '/orgs/:orgId/memberships',
    {
      ...organizer,
      schema: {
        tags: ['memberships'],
        summary: 'Waiting requests (oldest first) or members (by name) (organizer+)',
        security: BEARER,
        params: OrgParams,
        querystring: z.object({ status: z.enum(['pending', 'approved']).default('pending') }),
        response: { 200: z.array(ClubMember) },
      },
    },
    async (request) => listMemberships(db, request.params.orgId, request.query.status),
  );

  app.post(
    '/orgs/:orgId/memberships/:userId/approve',
    {
      ...organizer,
      schema: {
        tags: ['memberships'],
        summary: 'Accept a waiting request (organizer+)',
        security: BEARER,
        params: MemberParams,
        response: { 200: MyMembership },
      },
    },
    async (request) => decideMembership(db, request.params.orgId, request.params.userId, currentUser(request).id, true),
  );

  app.post(
    '/orgs/:orgId/memberships/:userId/reject',
    {
      ...organizer,
      schema: {
        tags: ['memberships'],
        summary: 'Refuse a waiting request; they can ask again later (organizer+)',
        security: BEARER,
        params: MemberParams,
        response: { 200: MyMembership },
      },
    },
    async (request) =>
      decideMembership(db, request.params.orgId, request.params.userId, currentUser(request).id, false),
  );

  app.delete(
    '/orgs/:orgId/memberships/:userId',
    {
      ...organizer,
      schema: {
        tags: ['memberships'],
        summary: 'Take someone off the member list (organizer+)',
        security: BEARER,
        params: MemberParams,
      },
    },
    async (request, reply) => {
      await removeClubMember(db, request.params.orgId, request.params.userId);
      return reply.status(204).send();
    },
  );
};
