import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser } from './plugin.js';
import { type AuthDeps, getProfile, login, logout, refresh, register } from './service.js';

const Email = z.email().max(254);
const DeviceId = z.string().min(1).max(128).optional().describe('Stable per-install id; tickets bind to it later');

const RegisterBody = z.object({
  email: Email,
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(120),
  university: z.string().trim().min(2).max(120).optional(),
  studentNumber: z.string().trim().min(1).max(32).optional(),
  deviceId: DeviceId,
});

const LoginBody = z.object({
  email: Email,
  password: z.string().min(1).max(128),
  deviceId: DeviceId,
});

const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

const PublicUser = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  university: z.string().nullable(),
  studentNumber: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  platformRole: z.enum(['user', 'admin']),
  createdAt: z.iso.datetime(),
});

const Tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().describe('Access token lifetime in seconds'),
});

const Session = Tokens.extend({ user: PublicUser });

const Profile = PublicUser.extend({
  memberships: z.array(
    z.object({
      organizationId: z.uuid(),
      slug: z.string(),
      name: z.string(),
      role: z.enum(['owner', 'organizer', 'scanner']),
    }),
  ),
});

// Students on campus Wi-Fi share one public IP, so login is limited per
// IP + email (stops password guessing on one account without locking out a
// whole lecture hall), and sign-up per IP is generous for "everyone install
// the app now" moments at events.
const LOGIN_RATE_LIMIT = {
  max: 10,
  timeWindow: '1 minute',
  hook: 'preHandler' as const, // after body parsing, so the email is available
  keyGenerator: (request: FastifyRequest) =>
    `login:${request.ip}:${String((request.body as { email?: unknown } | undefined)?.email).toLowerCase()}`,
};
const REGISTER_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };

export const authRoutes: FastifyPluginAsyncZod<{ auth: AuthDeps }> = async (app, { auth }) => {
  app.post(
    '/auth/register',
    {
      config: { rateLimit: REGISTER_RATE_LIMIT },
      schema: {
        tags: ['auth'],
        summary: 'Create an account and start a session',
        body: RegisterBody,
        response: { 201: Session },
      },
    },
    async (request, reply) => reply.status(201).send(await register(auth, request.body)),
  );

  app.post(
    '/auth/login',
    {
      config: { rateLimit: LOGIN_RATE_LIMIT },
      schema: { tags: ['auth'], summary: 'Start a session', body: LoginBody, response: { 200: Session } },
    },
    async (request) => login(auth, request.body),
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange a refresh token for a new token pair (the old one is retired)',
        body: RefreshBody,
        response: { 200: Tokens },
      },
    },
    async (request) => refresh(auth, request.body.refreshToken),
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], summary: "End this device's session", body: RefreshBody } },
    async (request, reply) => {
      await logout(auth, request.body.refreshToken);
      return reply.status(204).send();
    },
  );

  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'The signed-in user and their club roles',
        security: [{ bearerAuth: [] }],
        response: { 200: Profile },
      },
    },
    async (request) => getProfile(auth.db, currentUser(request).id),
  );
};
