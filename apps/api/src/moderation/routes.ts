import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import { BEARER, DateTimeOutput, EventParams } from '../schemas.js';
import { dismissReports, listOpenReports, removeEvent, reportEvent } from './service.js';

const Reason = z
  .enum(['inappropriate', 'spam', 'misleading', 'other'])
  .describe('inappropriate: offensive, hateful, sexual or violent; misleading: fake or not what it claims');

const ReportedEvent = z.object({
  event: z.object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(['draft', 'published', 'cancelled', 'completed']),
    startsAt: DateTimeOutput,
    organization: z.object({ id: z.uuid(), name: z.string() }),
  }),
  reports: z.array(
    z.object({ id: z.uuid(), reason: Reason, details: z.string().nullable(), createdAt: DateTimeOutput }),
  ),
});

export const moderationRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.post(
    '/events/:eventId/reports',
    {
      onRequest: app.authenticate,
      // Per person, not per IP: a whole campus can share one address. Counted
      // after authentication (preHandler) so the user is known.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request) => request.user?.id ?? request.ip,
        },
      },
      schema: {
        tags: ['moderation'],
        summary: 'Report an event that breaks the community rules; reporting again updates your report',
        security: BEARER,
        params: EventParams,
        body: z.object({ reason: Reason, details: z.string().trim().max(1000).nullable().optional() }),
      },
    },
    async (request, reply) => {
      await reportEvent(db, currentUser(request).id, request.params.eventId, request.body);
      // Warn level so new reports stand out in the hosting provider's logs.
      request.log.warn({ eventId: request.params.eventId, reason: request.body.reason }, 'event reported');
      return reply.status(204).send();
    },
  );

  // --- platform admins ---------------------------------------------------------

  const admin = { onRequest: app.authenticate, preHandler: app.requireAdmin };

  app.get(
    '/admin/reports',
    {
      ...admin,
      schema: {
        tags: ['moderation'],
        summary: 'Events with open reports, most reported first (platform admin)',
        security: BEARER,
        response: { 200: z.array(ReportedEvent) },
      },
    },
    async () => listOpenReports(db),
  );

  app.post(
    '/admin/events/:eventId/remove',
    {
      ...admin,
      schema: {
        tags: ['moderation'],
        summary: 'Take an event down: cancel it, replace its text and close its reports (platform admin)',
        security: BEARER,
        params: EventParams,
      },
    },
    async (request, reply) => {
      const { eventId } = request.params;
      const { originalTitle } = await removeEvent(db, eventId, currentUser(request).id);
      request.log.warn({ eventId, originalTitle }, 'event removed by a moderator');
      return reply.status(204).send();
    },
  );

  app.post(
    '/admin/events/:eventId/dismiss-reports',
    {
      ...admin,
      schema: {
        tags: ['moderation'],
        summary: "Close an event's open reports and leave the event as it is (platform admin)",
        security: BEARER,
        params: EventParams,
      },
    },
    async (request, reply) => {
      await dismissReports(db, request.params.eventId, currentUser(request).id);
      return reply.status(204).send();
    },
  );
};
