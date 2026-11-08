import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { AppError } from '../src/errors.js';
import type { ReadinessCheck } from '../src/routes/health.js';
import { testConfig as config } from './helpers.js';

// These tests never reach a database-backed route.
const db = {} as Database;

const up: ReadinessCheck = async () => undefined;
const down: ReadinessCheck = async () => {
  throw new Error('connection refused');
};

let app: App;
afterEach(() => app?.close());

async function build(readinessChecks: Record<string, ReadinessCheck> = { postgres: up, redis: up }) {
  app = await buildApp({ config, db, readinessChecks });
  return app;
}

describe('health', () => {
  it('reports liveness', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('is ready when every dependency answers', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'up', redis: 'up' } });
  });

  it('returns 503 and names the failing dependency', async () => {
    const res = await (await build({ postgres: up, redis: down })).inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable', checks: { postgres: 'up', redis: 'down' } });
  });
});

describe('request ids', () => {
  it('generates one and echoes it in the response header', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps an incoming x-request-id', async () => {
    const res = await (await build()).inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'gate-3-scan-42' },
    });
    expect(res.headers['x-request-id']).toBe('gate-3-scan-42');
  });
});

describe('problem+json errors', () => {
  async function buildWithTestRoutes() {
    const app = await build();
    app.post(
      '/test/echo',
      { schema: { body: z.object({ name: z.string().min(2), capacity: z.number().int().positive() }) } },
      async (request) => request.body,
    );
    app.get('/test/conflict', async () => {
      throw new AppError(409, 'ALREADY_CHECKED_IN', 'Ticket was checked in at 19:02 by gate 2');
    });
    app.get('/test/crash', async () => {
      throw new Error('db password is hunter2');
    });
    return app;
  }

  it('answers unknown routes with 404 problem details', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json()).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      instance: '/nope',
      traceId: res.headers['x-request-id'],
    });
  });

  it('lists each invalid field on validation failure', async () => {
    const res = await (await buildWithTestRoutes()).inject({
      method: 'POST',
      url: '/test/echo',
      payload: { name: 'x', capacity: -1 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', detail: 'Invalid request body' });
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['capacity', 'name']);
  });

  it('passes AppError status, code and message through', async () => {
    const res = await (await buildWithTestRoutes()).inject({ method: 'GET', url: '/test/conflict' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      title: 'Conflict',
      code: 'ALREADY_CHECKED_IN',
      detail: 'Ticket was checked in at 19:02 by gate 2',
    });
  });

  it('reports malformed JSON as a client error', async () => {
    const res = await (await buildWithTestRoutes()).inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ status: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' });
  });

  it('hides internal error details', async () => {
    const res = await (await buildWithTestRoutes()).inject({ method: 'GET', url: '/test/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR', detail: 'An unexpected error occurred' });
    expect(res.body).not.toContain('hunter2');
  });
});

describe('OpenAPI', () => {
  it('documents the health routes', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/health/live', '/health/ready']));
  });
});

describe('CORS', () => {
  it('lets the web build edit and delete, from allowed origins only', async () => {
    app = await buildApp({
      config: { ...config, CORS_ORIGINS: ['http://localhost:8081'] },
      db,
      readinessChecks: {},
    });
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/me',
        headers: { origin, 'access-control-request-method': 'PATCH' },
      });

    const allowed = await preflight('http://localhost:8081');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(String(allowed.headers['access-control-allow-methods']).split(/,\s*/)).toEqual(
      expect.arrayContaining(['PUT', 'PATCH', 'DELETE']),
    );
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
  });
});
