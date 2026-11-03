import type { LogLevel } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export type ReadinessCheck = () => Promise<unknown>;

const CHECK_TIMEOUT_MS = 2_000;
const VERBOSE_LEVELS = new Set(['trace', 'debug', 'info']);

const HealthResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.record(z.string(), z.enum(['up', 'down'])).optional(),
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * /health/live  - the process is up (container restart signal).
 * /health/ready - every dependency answers (load balancer traffic signal).
 */
export const healthRoutes: FastifyPluginAsyncZod<{ checks: Record<string, ReadinessCheck> }> = async (
  app,
  { checks },
) => {
  // Load balancers poll these every few seconds; keep them out of the info-level request log.
  // Only ever raise the threshold: a route-level level would otherwise override 'silent'.
  const logLevel: LogLevel = VERBOSE_LEVELS.has(app.log.level) ? 'warn' : (app.log.level as LogLevel);

  app.get(
    '/health/live',
    { logLevel, schema: { tags: ['health'], summary: 'Liveness probe', response: { 200: HealthResponse } } },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      logLevel,
      schema: {
        tags: ['health'],
        summary: 'Readiness probe: PostgreSQL and Redis reachable',
        response: { 200: HealthResponse, 503: HealthResponse },
      },
    },
    async (request, reply) => {
      const results = await Promise.all(
        Object.entries(checks).map(async ([name, check]) => {
          try {
            await withTimeout(check(), CHECK_TIMEOUT_MS);
            return [name, 'up'] as const;
          } catch (err) {
            request.log.warn({ err, check: name }, 'readiness check failed');
            return [name, 'down'] as const;
          }
        }),
      );
      const healthy = results.every(([, state]) => state === 'up');
      return reply
        .status(healthy ? 200 : 503)
        .send({ status: healthy ? 'ok' : 'unavailable', checks: Object.fromEntries(results) });
    },
  );
};
