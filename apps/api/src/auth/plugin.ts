import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Database } from '../db.js';
import type { OrgRole } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { AccessTokens, AuthUser } from './tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** onRequest hook: requires a valid bearer access token and sets request.user. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * preHandler for routes with an :orgId param: requires at least `minimum`
     * in that club (owner > organizer > scanner). Platform admins always pass.
     */
    requireOrgRole: (minimum: OrgRole) => (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const ORG_ROLE_RANK: Record<OrgRole, number> = { scanner: 1, organizer: 2, owner: 3 };

/** The authenticated user; only valid on routes guarded by app.authenticate. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  return request.user;
}

export const authPlugin = fp<{ db: Database; accessTokens: AccessTokens }>(
  async (app, { db, accessTokens }) => {
    app.decorateRequest('user', null);

    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
      if (!token) {
        reply.header('www-authenticate', 'Bearer');
        throw new AppError(401, 'UNAUTHENTICATED', 'Missing bearer access token');
      }
      try {
        request.user = await accessTokens.verify(token);
      } catch (err) {
        reply.header('www-authenticate', 'Bearer error="invalid_token"');
        throw err;
      }
    });

    app.decorate('requireOrgRole', (minimum: OrgRole) => async (request: FastifyRequest) => {
      const user = currentUser(request);
      if (user.platformRole === 'admin') return;

      const { orgId } = request.params as { orgId?: string };
      if (!orgId) throw new Error('requireOrgRole needs a route with an :orgId param');

      const membership = await db
        .selectFrom('organization_members')
        .select('role')
        .where('organization_id', '=', orgId)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!membership || ORG_ROLE_RANK[membership.role] < ORG_ROLE_RANK[minimum]) {
        throw new AppError(403, 'FORBIDDEN', `Requires the ${minimum} role in this organization`);
      }
    });
  },
  { name: 'auth' },
);
