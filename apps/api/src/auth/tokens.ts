import { createHash, randomBytes } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import type { PlatformRole } from '../db/schema.js';
import { AppError } from '../errors.js';

export const TOKEN_ISSUER = 'etkin-api';
export const TOKEN_AUDIENCE = 'etkin-app';

export interface AuthUser {
  id: string;
  platformRole: PlatformRole;
}

export type AccessTokens = ReturnType<typeof createAccessTokens>;

/**
 * Short-lived HS256 JWTs. Club roles are deliberately not embedded: they are
 * looked up per request, so removing someone from a club takes effect at once.
 */
export function createAccessTokens(secret: string, ttlSeconds: number) {
  const key = new TextEncoder().encode(secret);

  return {
    ttlSeconds,

    sign(user: AuthUser): Promise<string> {
      return new SignJWT({ role: user.platformRole })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(user.id)
        .setIssuer(TOKEN_ISSUER)
        .setAudience(TOKEN_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key);
    },

    async verify(token: string): Promise<AuthUser> {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: TOKEN_ISSUER,
          audience: TOKEN_AUDIENCE,
          algorithms: ['HS256'],
        });
        if (typeof payload.sub !== 'string' || (payload.role !== 'user' && payload.role !== 'admin')) {
          throw new Error('unexpected claims');
        }
        return { id: payload.sub, platformRole: payload.role };
      } catch (err) {
        if (err instanceof errors.JWTExpired) {
          throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired; refresh it');
        }
        throw new AppError(401, 'INVALID_TOKEN', 'Access token is invalid');
      }
    },
  };
}

/** Opaque 256-bit refresh token. Only its SHA-256 is stored. */
export function newRefreshToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
