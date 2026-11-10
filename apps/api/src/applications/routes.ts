import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import { BEARER, DateTimeOutput, OrgParams } from '../schemas.js';
import { UniversityRef } from '../universities/routes.js';
import { verificationUrl } from './names.js';
import { decideApplication, getApplication, listPendingApplications, updateApplication } from './service.js';

export const ClubStatus = z
  .enum(['pending', 'approved', 'rejected'])
  .describe('pending: waiting for a platform admin; only an approved club can publish events');

export const ApplicantRole = z
  .enum(['president', 'board_member', 'advisor', 'other'])
  .describe("The applicant's role in the club");

export const VerificationLink = z
  .string()
  .max(300)
  .transform((value, ctx) => {
    const url = verificationUrl(value);
    if (!url) {
      ctx.addIssue({ code: 'custom', message: 'an Instagram account (@club) or an http(s) address' });
      return z.NEVER;
    }
    return url;
  })
  .describe('Where the admin can check the club: an Instagram account ("@club") or a web page');

export const ApplicationNote = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .describe('Anything else the admin should know');

const ApplicationBody = z.object({
  applicantRole: ApplicantRole,
  verificationLink: VerificationLink,
  applicationNote: ApplicationNote,
});

const Application = z.object({
  status: ClubStatus,
  applicantRole: ApplicantRole.nullable(),
  verificationUrl: z.string().nullable(),
  applicationNote: z.string().nullable(),
  submittedAt: DateTimeOutput.nullable(),
  reviewedAt: DateTimeOutput.nullable(),
  rejectionReason: z
    .string()
    .nullable()
    .describe('Why it was last refused; only meaningful while the status is rejected'),
});

const PendingApplication = z.object({
  club: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    university: UniversityRef.nullable(),
    createdAt: DateTimeOutput,
  }),
  applicant: z.object({ id: z.uuid(), fullName: z.string(), email: z.string() }).nullable(),
  applicantRole: ApplicantRole.nullable(),
  verificationUrl: z.string().nullable(),
  applicationNote: z.string().nullable(),
  submittedAt: DateTimeOutput,
  previousRejection: z.string().nullable().describe('Why it was refused before, if this is a second try'),
  similarClubs: z
    .array(z.object({ id: z.uuid(), name: z.string(), status: ClubStatus }))
    .describe('Clubs at the same university with a similar name: a possible copy'),
});

export const applicationRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const owner = { onRequest: app.authenticate, preHandler: app.requireOrgRole('owner') };

  app.get(
    '/orgs/:orgId/application',
    {
      ...owner,
      schema: {
        tags: ['applications'],
        summary: "The club's application and its outcome (owner)",
        security: BEARER,
        params: OrgParams,
        response: { 200: Application },
      },
    },
    async (request) => getApplication(db, request.params.orgId),
  );

  app.put(
    '/orgs/:orgId/application',
    {
      ...owner,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (request) => request.user?.id ?? request.ip,
        },
      },
      schema: {
        tags: ['applications'],
        summary: 'Edit a waiting application, or apply again after a refusal (owner)',
        security: BEARER,
        params: OrgParams,
        body: ApplicationBody,
        response: { 200: Application },
      },
    },
    async (request) => {
      const { applicantRole, verificationLink, applicationNote } = request.body;
      return updateApplication(db, currentUser(request).id, request.params.orgId, {
        applicantRole,
        verificationUrl: verificationLink,
        applicationNote,
      });
    },
  );

  // --- platform admins ---------------------------------------------------------

  const admin = { onRequest: app.authenticate, preHandler: app.requireAdmin };

  app.get(
    '/admin/club-applications',
    {
      ...admin,
      schema: {
        tags: ['applications'],
        summary: 'Clubs waiting for approval, oldest first (platform admin)',
        security: BEARER,
        response: { 200: z.array(PendingApplication) },
      },
    },
    async () => listPendingApplications(db),
  );

  app.post(
    '/admin/club-applications/:orgId/approve',
    {
      ...admin,
      schema: {
        tags: ['applications'],
        summary: 'Approve a club: it can publish events from now on (platform admin)',
        security: BEARER,
        params: OrgParams,
      },
    },
    async (request, reply) => {
      const { name } = await decideApplication(db, request.params.orgId, currentUser(request).id, { approve: true });
      request.log.info({ orgId: request.params.orgId, name }, 'club approved');
      return reply.status(204).send();
    },
  );

  app.post(
    '/admin/club-applications/:orgId/reject',
    {
      ...admin,
      schema: {
        tags: ['applications'],
        summary: 'Refuse a club, saying why; its owner can fix the application and apply again (platform admin)',
        security: BEARER,
        params: OrgParams,
        body: z.object({ reason: z.string().trim().min(3).max(500).describe('Shown to the club owner') }),
      },
    },
    async (request, reply) => {
      const { orgId } = request.params;
      const { name } = await decideApplication(db, orgId, currentUser(request).id, {
        approve: false,
        reason: request.body.reason,
      });
      request.log.info({ orgId, name }, 'club application refused');
      return reply.status(204).send();
    },
  );
};
