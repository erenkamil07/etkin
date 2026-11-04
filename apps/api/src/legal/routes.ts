import type { FastifyPluginAsync } from 'fastify';
import { accountDeletion, privacyPolicy, terms } from './pages.js';

/** Public pages the Play Store listing and the app link to: privacy, terms and how to delete an account. */
export const legalRoutes: FastifyPluginAsync = async (app) => {
  for (const [url, html] of [
    ['/privacy', privacyPolicy],
    ['/terms', terms],
    ['/account-deletion', accountDeletion],
  ] as const) {
    app.get(url, { schema: { hide: true } }, async (_request, reply) =>
      reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=3600').send(html),
    );
  }
};
