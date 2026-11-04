import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { OrgRole } from '../db/schema.js';
import type { Database } from '../db.js';
import { AppError } from '../errors.js';
import type { AccessTokens, AuthUser } from './tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** onRequest hook: requires a valid bearer access token and sets request.user. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** onRequest hook for public routes that show more to signed-in users; rejects only a bad token. */
    authenticateOptional: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * preHandler for routes with an :orgId param: requires at least `minimum`
     * in that club (owner > organizer > scanner). Platform admins always pass.
     */
    requireOrgRole: (minimum: OrgRole) => (request: FastifyRequest) => Promise<void>;
    /** preHandler: requires a platform admin (moderation). */
    requireAdmin: (request: FastifyRequest) => Promise<void>;
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

export async function findOrgRole(db: Database, orgId: string, userId: string): Promise<OrgRole | undefined> {
  const row = await db
    .selectFrom('organization_members')
    .select('role')
    .where('organization_id', '=', orgId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.role;
}

export async function assertOrgRole(db: Database, user: AuthUser, orgId: string, minimum: OrgRole) {
  if (user.platformRole === 'admin') return;
  const role = await findOrgRole(db, orgId, user.id);
  if (!role || ORG_ROLE_RANK[role] < ORG_ROLE_RANK[minimum]) {
    throw new AppError(403, 'FORBIDDEN', `Requires the ${minimum} role in this organization`);
  }
}

export const authPlugin = fp<{ db: Database; accessTokens: AccessTokens }>(
  async (app, { db, accessTokens }) => {
    app.decorateRequest('user', null);

    async function verifyBearer(request: FastifyRequest, reply: FastifyReply, token: string) {
      try {
        request.user = await accessTokens.verify(token);
      } catch (err) {
        reply.header('www-authenticate', 'Bearer error="invalid_token"');
        throw err;
      }
    }
    const bearerToken = (request: FastifyRequest) => /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];

    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = bearerToken(request);
      if (!token) {
        reply.header('www-authenticate', 'Bearer');
        throw new AppError(401, 'UNAUTHENTICATED', 'Missing bearer access token');
      }
      await verifyBearer(request, reply, token);
    });

    app.decorate('authenticateOptional', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = bearerToken(request);
      if (token) await verifyBearer(request, reply, token);
    });

    app.decorate('requireOrgRole', (minimum: OrgRole) => async (request: FastifyRequest) => {
      const { orgId } = request.params as { orgId?: string };
      if (!orgId) throw new Error('requireOrgRole needs a route with an :orgId param');
      await assertOrgRole(db, currentUser(request), orgId, minimum);
    });

    app.decorate('requireAdmin', async (request: FastifyRequest) => {
      if (currentUser(request).platformRole !== 'admin') {
        throw new AppError(403, 'FORBIDDEN', 'Requires a platform admin');
      }
    });
  },
  { name: 'auth' },
);
