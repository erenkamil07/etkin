import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertOrgRole, currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import { atLeastOneField, BEARER, DateTimeOutput, OrgParams } from '../schemas.js';
import { createOrg, getOrg, listMembers, removeMember, updateOrg, upsertMember } from './service.js';

const OrgRoleSchema = z.enum(['owner', 'organizer', 'scanner']);

const Org = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  createdAt: DateTimeOutput,
});

const Member = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  role: OrgRoleSchema,
  joinedAt: DateTimeOutput,
});

const Name = z.string().trim().min(2).max(120);
const Description = z.string().trim().max(2000).nullable().optional();
const LogoUrl = z.url({ protocol: /^https$/ }).max(500).nullable().optional();

const CreateOrgBody = z.object({
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens, e.g. ieee-odtu'),
  name: Name,
  description: Description,
  logoUrl: LogoUrl,
});

const UpdateOrgBody = z
  .object({ name: Name.optional(), description: Description, logoUrl: LogoUrl })
  .refine(atLeastOneField, 'Provide at least one field to change');

export const orgRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.post(
    '/orgs',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['orgs'],
        summary: 'Create a club; you become its owner',
        security: BEARER,
        body: CreateOrgBody,
        response: { 201: Org },
      },
    },
    async (request, reply) => reply.status(201).send(await createOrg(db, currentUser(request).id, request.body)),
  );

  app.get(
    '/orgs/:orgId',
    { schema: { tags: ['orgs'], summary: 'Public club profile', params: OrgParams, response: { 200: Org } } },
    async (request) => getOrg(db, request.params.orgId),
  );

  app.patch(
    '/orgs/:orgId',
    {
      onRequest: app.authenticate,
      preHandler: app.requireOrgRole('organizer'),
      schema: {
        tags: ['orgs'],
        summary: 'Edit the club profile (organizer+); the slug is permanent',
        security: BEARER,
        params: OrgParams,
        body: UpdateOrgBody,
        response: { 200: Org },
      },
    },
    async (request) => updateOrg(db, request.params.orgId, request.body),
  );

  app.get(
    '/orgs/:orgId/members',
    {
      onRequest: app.authenticate,
      preHandler: app.requireOrgRole('organizer'),
      schema: {
        tags: ['orgs'],
        summary: 'Club team: owners, organizers and door scanners (organizer+)',
        security: BEARER,
        params: OrgParams,
        response: { 200: z.array(Member) },
      },
    },
    async (request) => listMembers(db, request.params.orgId),
  );

  app.post(
    '/orgs/:orgId/members',
    {
      onRequest: app.authenticate,
      preHandler: app.requireOrgRole('owner'),
      schema: {
        tags: ['orgs'],
        summary: "Add a registered user to the team or change their role (owner)",
        security: BEARER,
        params: OrgParams,
        body: z.object({ email: z.email(), role: OrgRoleSchema }),
        response: { 200: Member },
      },
    },
    async (request) => upsertMember(db, request.params.orgId, request.body.email, request.body.role),
  );

  app.delete(
    '/orgs/:orgId/members/:userId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['orgs'],
        summary: 'Remove someone from the team (owner), or leave it yourself',
        security: BEARER,
        params: OrgParams.extend({ userId: z.uuid() }),
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { orgId, userId } = request.params;
      if (user.id !== userId) await assertOrgRole(db, user, orgId, 'owner');
      await removeMember(db, orgId, userId);
      return reply.status(204).send();
    },
  );
};
