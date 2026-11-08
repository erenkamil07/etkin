import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { analyticsRoutes } from './analytics/routes.js';
import { authPlugin } from './auth/plugin.js';
import { authRoutes } from './auth/routes.js';
import { createAccessTokens } from './auth/tokens.js';
import { avatarRoutes } from './avatars/routes.js';
import { checkInRoutes } from './checkins/routes.js';
import type { Config } from './config.js';
import { coverRoutes } from './covers/routes.js';
import type { Database } from './db.js';
import { AppError, registerErrorHandling } from './errors.js';
import { eventRoutes } from './events/routes.js';
import { legalRoutes } from './legal/routes.js';
import { loyaltyRoutes } from './loyalty/routes.js';
import { moderationRoutes } from './moderation/routes.js';
import { orgRoutes } from './orgs/routes.js';
import { healthRoutes, type ReadinessCheck } from './routes/health.js';
import { ticketRoutes } from './tickets/routes.js';
import { universityRoutes } from './universities/routes.js';

export interface AppDeps {
  config: Config;
  db: Database;
  /** Named probes for /health/ready; each rejects when its dependency is unreachable. */
  readinessChecks: Record<string, ReadinessCheck>;
}

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'development') {
    return {
      level: config.LOG_LEVEL,
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    };
  }
  return { level: config.LOG_LEVEL };
}

export async function buildApp({ config, db, readinessChecks }: AppDeps) {
  const app = Fastify({
    logger: loggerOptions(config),
    // Honour an incoming x-request-id (ALB, mobile client) so one id follows a request end to end.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: config.NODE_ENV === 'production',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  registerErrorHandling(app);

  await app.register(helmet);
  // Browsers only (the native app sends no Origin). The plugin's default methods
  // stop at POST, which would block the web build's edits, poster uploads and account deletion.
  await app.register(cors, {
    origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  // Opt-in per route. In-memory counters are per instance; move to a Redis store
  // once the API runs as more than a couple of tasks.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', `Too many attempts; try again in ${context.after}`),
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Etkin API',
        description: 'Event ticketing, dynamic-QR check-in and loyalty for university communities.',
        version: '0.1.0',
      },
      tags: [
        { name: 'auth', description: 'Accounts and sessions' },
        { name: 'orgs', description: 'Clubs and their teams' },
        { name: 'events', description: 'Events and ticket types' },
        { name: 'tickets', description: 'Claiming and managing your tickets' },
        { name: 'check-in', description: 'Admitting people at the door' },
        { name: 'loyalty', description: 'Your club points and badges' },
        { name: 'analytics', description: 'Attendance numbers for organizers' },
        { name: 'moderation', description: 'Reporting events and reviewing reports' },
        { name: 'universities', description: 'The list clubs and students pick their university from' },
        { name: 'health', description: 'Liveness and readiness probes' },
      ],
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });
  // staticCSP gives the docs page its own CSP, since helmet's default blocks Swagger UI's assets.
  // Its response highlighter sets inline styles, so allow those (styles only, never scripts) there.
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    transformStaticCSP: (header) => header.replace(/style-src [^;]*/, "style-src 'self' https: 'unsafe-inline'"),
  });

  const accessTokens = createAccessTokens(config.JWT_ACCESS_SECRET, config.ACCESS_TOKEN_TTL_SECONDS);
  await app.register(authPlugin, { db, accessTokens });

  await app.register(healthRoutes, { checks: readinessChecks });
  await app.register(legalRoutes);
  await app.register(authRoutes, {
    auth: { db, accessTokens, refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS },
  });
  await app.register(orgRoutes, { db });
  await app.register(eventRoutes, { db });
  await app.register(coverRoutes, { db });
  await app.register(avatarRoutes, { db });
  await app.register(ticketRoutes, { db, qrMasterKey: config.QR_MASTER_KEY });
  await app.register(checkInRoutes, { db, qrMasterKey: config.QR_MASTER_KEY });
  await app.register(loyaltyRoutes, { db });
  await app.register(analyticsRoutes, { db });
  await app.register(moderationRoutes, { db });
  await app.register(universityRoutes, { db });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
