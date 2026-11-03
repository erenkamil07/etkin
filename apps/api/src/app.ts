import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { registerErrorHandling } from './errors.js';
import { healthRoutes, type ReadinessCheck } from './routes/health.js';

export interface AppDeps {
  config: Config;
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

export async function buildApp({ config, readinessChecks }: AppDeps) {
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
  await app.register(cors, { origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Etkin API',
        description: 'Event ticketing, dynamic-QR check-in and loyalty for university communities.',
        version: '0.1.0',
      },
      tags: [{ name: 'health', description: 'Liveness and readiness probes' }],
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

  await app.register(healthRoutes, { checks: readinessChecks });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
