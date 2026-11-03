import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db.js';
import { drainOutbox, type OutboxHandlers } from '../../src/outbox/processor.js';
import { createIntegrationDatabase } from './database.js';

let db: Database;

beforeAll(async () => {
  db = await createIntegrationDatabase();
});

afterAll(async () => {
  await db.destroy();
});

describe('outbox workers on real PostgreSQL', () => {
  it('lets four workers drain 40 events in parallel, each handled exactly once', async () => {
    await db
      .insertInto('outbox')
      .values(Array.from({ length: 40 }, (_, n) => ({ topic: 'test.count', payload: JSON.stringify({ n }) })))
      .execute();

    const handledBy = new Map<number, string[]>();
    const handlers = (worker: string): OutboxHandlers => ({
      'test.count': async (_db, payload) => {
        const { n } = payload as { n: number };
        handledBy.set(n, [...(handledBy.get(n) ?? []), worker]);
        await sleep(5); // hold the row lock long enough for the workers to overlap
      },
    });

    const results = await Promise.all(['w1', 'w2', 'w3', 'w4'].map((worker) => drainOutbox(db, handlers(worker))));

    expect(results.reduce((sum, r) => sum + r.processed, 0)).toBe(40);
    expect(handledBy.size).toBe(40);
    expect([...handledBy.values()].every((workers) => workers.length === 1)).toBe(true);
    // SKIP LOCKED means they shared the work instead of queueing behind one another.
    expect(results.filter((r) => r.processed > 0).length).toBeGreaterThan(1);

    const pending = await db.selectFrom('outbox').select('id').where('processed_at', 'is', null).execute();
    expect(pending).toEqual([]);
  });
});
