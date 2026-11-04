import type { FastifyPluginAsync } from 'fastify';
import { accountDeletion, privacyPolicy } from './pages.js';

/** Public pages the Play Store listing links to: the privacy policy and how to delete an account. */
export const legalRoutes: FastifyPluginAsync = async (app) => {
  for (const [url, html] of [
    ['/privacy', privacyPolicy],
    ['/account-deletion', accountDeletion],
  ] as const) {
    app.get(url, { schema: { hide: true } }, async (_request, reply) =>
      reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=3600').send(html),
    );
  }
};
