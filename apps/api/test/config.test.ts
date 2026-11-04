import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const required = {
  DATABASE_URL: 'postgres://etkin:etkin@localhost:5432/etkin',
  REDIS_URL: 'redis://localhost:6379/0',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  QR_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(required);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_POOL_MAX: 10,
      CORS_ORIGINS: [],
      RUN_WORKER_IN_API: false,
    });
  });

  it('reads RUN_WORKER_IN_API as a boolean', () => {
    expect(loadConfig({ ...required, RUN_WORKER_IN_API: 'true' }).RUN_WORKER_IN_API).toBe(true);
    expect(loadConfig({ ...required, RUN_WORKER_IN_API: 'false' }).RUN_WORKER_IN_API).toBe(false);
    expect(() => loadConfig({ ...required, RUN_WORKER_IN_API: 'sometimes' })).toThrow('RUN_WORKER_IN_API');
  });

  it('coerces numbers and splits CORS origins', () => {
    const config = loadConfig({ ...required, PORT: '8080', CORS_ORIGINS: 'http://a.test, http://b.test,' });
    expect(config.PORT).toBe(8080);
    expect(config.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadConfig({ ...required, JWT_ACCESS_SECRET: 'too-short' })).toThrow('JWT_ACCESS_SECRET');
  });

  it('decodes the QR master key and rejects weak ones', () => {
    expect(loadConfig(required).QR_MASTER_KEY).toEqual(new Uint8Array(32).fill(1));
    expect(() => loadConfig({ ...required, QR_MASTER_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      'at least 32 bytes',
    );
    expect(() => loadConfig({ ...required, QR_MASTER_KEY: 'not base64!' })).toThrow('QR_MASTER_KEY');
  });

  it('names every invalid variable', () => {
    const load = () => loadConfig({ REDIS_URL: 'http://wrong-scheme', PORT: 'abc' });
    for (const name of ['DATABASE_URL', 'PORT', 'REDIS_URL']) {
      expect(load).toThrow(name);
    }
  });
});
