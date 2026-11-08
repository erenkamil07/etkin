import { createHash } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { cleanJpeg, NotAJpegError } from '../covers/jpeg.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import { BEARER } from '../schemas.js';

/** The app sends a 400 px square of about 40 KB. */
const MAX_AVATAR_BYTES = 524_288;

const avatarPath = (userId: string, version: string) => `/users/${userId}/avatar?v=${version}`;

export const avatarRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  // Scoped to this plugin, like the poster routes.
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: MAX_AVATAR_BYTES }, (_request, body, done) =>
    done(null, body),
  );

  app.put(
    '/me/avatar',
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
        tags: ['auth'],
        summary: 'Set your profile photo: a JPEG up to 512 KB, stored without its metadata',
        security: BEARER,
        consumes: ['image/jpeg'],
        response: { 200: z.object({ avatarUrl: z.string() }) },
      },
    },
    async (request) => {
      const userId = currentUser(request).id;
      let image: ReturnType<typeof cleanJpeg>;
      try {
        if (!Buffer.isBuffer(request.body)) throw new NotAJpegError('no body');
        image = cleanJpeg(request.body);
      } catch (err) {
        if (err instanceof NotAJpegError)
          throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Profile photos must be JPEG images');
        throw err;
      }
      const version = createHash('sha256').update(image.data).digest('base64url').slice(0, 12);
      const avatarUrl = avatarPath(userId, version);
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('user_avatars')
          .values({ user_id: userId, data: image.data, version })
          .onConflict((oc) => oc.column('user_id').doUpdateSet({ data: image.data, version, updated_at: new Date() }))
          .execute();
        await trx.updateTable('users').set({ avatar_url: avatarUrl }).where('id', '=', userId).execute();
      });
      return { avatarUrl };
    },
  );

  app.delete(
    '/me/avatar',
    { onRequest: app.authenticate, schema: { tags: ['auth'], summary: 'Remove your profile photo', security: BEARER } },
    async (request, reply) => {
      const userId = currentUser(request).id;
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('user_avatars').where('user_id', '=', userId).execute();
        await trx.updateTable('users').set({ avatar_url: null }).where('id', '=', userId).execute();
      });
      return reply.status(204).send();
    },
  );

  app.get(
    '/users/:userId/avatar',
    {
      schema: {
        tags: ['auth'],
        summary: 'A profile photo. Only the current ?v= works, and only the club teams that see the person get it',
        params: z.object({ userId: z.uuid() }),
        querystring: z.object({ v: z.string().max(40) }),
      },
    },
    async (request, reply) => {
      const avatar = await db
        .selectFrom('user_avatars')
        .select(['data', 'version'])
        .where('user_id', '=', request.params.userId)
        .executeTakeFirst();
      if (!avatar || avatar.version !== request.query.v) {
        throw new AppError(404, 'AVATAR_NOT_FOUND', 'No such profile photo');
      }
      return reply
        .type('image/jpeg')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(avatar.data);
    },
  );
};
