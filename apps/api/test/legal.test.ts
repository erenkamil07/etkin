import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app.js';
import type { Database } from '../src/db.js';
import { CONTACT_EMAIL } from '../src/legal/pages.js';
import { createTestDatabase, testConfig } from './helpers.js';

let db: Database;
let app: App;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ config: testConfig, db, readinessChecks: {} });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe('legal pages', () => {
  it('serves the privacy policy as a script-free HTML page', async () => {
    const res = await app.inject({ method: 'GET', url: '/privacy' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.body).toContain('Etkin Gizlilik Politikası');
    expect(res.body).toContain(CONTACT_EMAIL);
    expect(res.body).not.toContain('<script');
  });

  it('explains how to delete an account, with and without the app', async () => {
    const res = await app.inject({ method: 'GET', url: '/account-deletion' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Hesabımı sil');
    expect(res.body).toContain('Etkin hesap silme');
  });

  it('publishes the community rules and how to report an event', async () => {
    const res = await app.inject({ method: 'GET', url: '/terms' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Topluluk kuralları');
    expect(res.body).toContain('Etkinliği bildir');
    expect(res.body).not.toContain('<script');
  });

  it('keeps the pages out of the API docs', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    expect(spec.paths).not.toHaveProperty('/privacy');
    expect(spec.paths).not.toHaveProperty('/terms');
    expect(spec.paths).not.toHaveProperty('/account-deletion');
  });
});
