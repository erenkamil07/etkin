import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const required = {
  DATABASE_URL: 'postgres://etkin:etkin@localhost:5432/etkin',
  REDIS_URL: 'redis://localhost:6379/0',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(required);
    expect(config).toMatchObject({ NODE_ENV: 'development', PORT: 3000, DATABASE_POOL_MAX: 10, CORS_ORIGINS: [] });
  });

  it('coerces numbers and splits CORS origins', () => {
    const config = loadConfig({ ...required, PORT: '8080', CORS_ORIGINS: 'http://a.test, http://b.test,' });
    expect(config.PORT).toBe(8080);
    expect(config.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('names every invalid variable', () => {
    const load = () => loadConfig({ REDIS_URL: 'http://wrong-scheme', PORT: 'abc' });
    for (const name of ['DATABASE_URL', 'PORT', 'REDIS_URL']) {
      expect(load).toThrow(name);
    }
  });
});
