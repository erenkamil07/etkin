import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../db.js';
import { listUniversities } from './service.js';

export const UniversityRef = z.object({ id: z.number().int(), name: z.string() });
export const UniversityId = z.number().int().positive().describe('An id from GET /universities');

export const universityRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/universities',
    {
      schema: {
        tags: ['universities'],
        summary: 'Every university in Turkey, alphabetical; clubs and students pick theirs from here',
        response: { 200: z.array(UniversityRef.extend({ city: z.string() })) },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=86400');
      return listUniversities(db);
    },
  );
};
