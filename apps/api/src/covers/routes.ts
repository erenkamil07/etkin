import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { BEARER, EventParams, OrgEventParams } from '../schemas.js';
import { deleteCover, loadCover, MAX_COVER_BYTES, saveCover } from './service.js';

export const Cover = z
  .object({
    url: z.string().describe('Path on this API, e.g. /events/<id>/cover?v=<version>; it changes with the poster'),
    width: z.number().int(),
    height: z.number().int(),
  })
  .describe("The event's poster, if it has one");

export const coverRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  // Posters arrive as the raw JPEG. Scoped to this plugin, so no other route accepts images.
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: MAX_COVER_BYTES }, (_request, body, done) =>
    done(null, body),
  );

  const organizer = { onRequest: app.authenticate, preHandler: app.requireOrgRole('organizer') };

  app.put(
    '/orgs/:orgId/events/:eventId/cover',
    {
      ...organizer,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (request) => request.user?.id ?? request.ip,
        },
      },
      schema: {
        tags: ['events'],
        summary: 'Upload or replace the event poster: a JPEG up to 1.5 MB, stored without its metadata (organizer+)',
        security: BEARER,
        consumes: ['image/jpeg'],
        params: OrgEventParams,
        response: { 200: Cover },
      },
    },
    async (request) => saveCover(db, request.params.orgId, request.params.eventId, request.body),
  );

  app.delete(
    '/orgs/:orgId/events/:eventId/cover',
    {
      ...organizer,
      schema: {
        tags: ['events'],
        summary: 'Remove the event poster (organizer+)',
        security: BEARER,
        params: OrgEventParams,
      },
    },
    async (request, reply) => {
      await deleteCover(db, request.params.orgId, request.params.eventId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/events/:eventId/cover',
    {
      schema: {
        tags: ['events'],
        summary: "The event's poster as JPEG; with the current ?v= it is cached for good",
        params: EventParams,
        querystring: z.object({ v: z.string().max(40).optional() }),
      },
    },
    async (request, reply) => {
      const cover = await loadCover(db, request.params.eventId);
      if (!cover) throw new AppError(404, 'COVER_NOT_FOUND', 'This event has no poster');
      const current = request.query.v === cover.version;
      return (
        reply
          .type('image/jpeg')
          .header('etag', `"${cover.version}"`)
          .header('cache-control', current ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
          // The website on another origin shows posters in <img>; helmet's default would block that.
          .header('cross-origin-resource-policy', 'cross-origin')
          .send(cover.data)
      );
    },
  );
};
