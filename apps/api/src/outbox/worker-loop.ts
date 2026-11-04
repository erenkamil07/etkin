import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db.js';
import { completeEndedEvents } from '../events/service.js';
import { outboxHandlers } from './handlers.js';
import { drainOutbox } from './processor.js';

const IDLE_POLL_MS = 1_000;
const HOUSEKEEPING_EVERY_MS = 60_000;

type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

/**
 * Drains the transactional outbox (badges today; push notifications later) and
 * runs light housekeeping until `signal` aborts, finishing the batch in hand
 * first. It runs as its own process (worker.ts) or inside the API
 * (RUN_WORKER_IN_API); SKIP LOCKED keeps any number of copies from stepping on
 * each other.
 */
export async function runWorkerLoop(db: Database, log: Logger, signal: AbortSignal): Promise<void> {
  log.info('worker started');
  let lastHousekeeping = 0;
  while (!signal.aborted) {
    try {
      if (Date.now() - lastHousekeeping >= HOUSEKEEPING_EVERY_MS) {
        const completed = await completeEndedEvents(db);
        if (completed > 0) log.info({ completed }, 'marked ended events completed');
        lastHousekeeping = Date.now();
      }
      const { processed, failed } = await drainOutbox(db, outboxHandlers, { log });
      if (processed + failed > 0) log.info({ processed, failed }, 'outbox batch');
      else await sleep(IDLE_POLL_MS, undefined, { signal }).catch(() => {});
    } catch (err) {
      // Database unreachable and the like: keep the loop alive and try again shortly.
      log.error({ err }, 'worker loop failed');
      await sleep(5 * IDLE_POLL_MS, undefined, { signal }).catch(() => {});
    }
  }
  log.info('worker stopped');
}
