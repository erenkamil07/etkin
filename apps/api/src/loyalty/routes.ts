import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Database } from '../db.js';
import { BEARER, DateTimeOutput } from '../schemas.js';
import { getMyBadges, getMyPoints } from './service.js';

const OrgRef = z.object({ id: z.uuid(), slug: z.string(), name: z.string() });

const Points = z.object({
  balance: z.number().int().describe('Spendable points across all clubs'),
  lifetimeEarned: z.number().int().describe('Never decreases when points are spent; drives early access'),
  clubs: z.array(z.object({ organization: OrgRef, balance: z.number().int(), lifetimeEarned: z.number().int() })),
  history: z.array(
    z.object({
      delta: z.number().int(),
      reason: z.enum(['checkin', 'bonus', 'redemption', 'adjustment', 'reversal']),
      note: z.string().nullable(),
      at: DateTimeOutput,
      organization: OrgRef,
      event: z.object({ id: z.uuid(), title: z.string() }).nullable(),
    }),
  ),
});

const Badge = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  iconUrl: z.string().nullable(),
  awardedAt: DateTimeOutput,
  organization: OrgRef.nullable().describe('Null for platform-wide badges'),
});

export const loyaltyRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/me/points',
    {
      schema: {
        tags: ['loyalty'],
        summary: 'Your club points and the latest 20 changes',
        security: BEARER,
        response: { 200: Points },
      },
    },
    async (request) => getMyPoints(db, currentUser(request).id),
  );

  app.get(
    '/me/badges',
    {
      schema: {
        tags: ['loyalty'],
        summary: 'Badges you have earned',
        security: BEARER,
        response: { 200: z.array(Badge) },
      },
    },
    async (request) => getMyBadges(db, currentUser(request).id),
  );
};
