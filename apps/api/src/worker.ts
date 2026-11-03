// Background worker: drains the transactional outbox (badges today; push
// notifications later) and runs light housekeeping. Run as many copies as
// needed; SKIP LOCKED keeps them from stepping on each other.
import { setTimeout as sleep } from 'node:timers/promises';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { completeEndedEvents } from './events/service.js';
import { outboxHandlers } from './outbox/handlers.js';
import { drainOutbox } from './outbox/processor.js';

const IDLE_POLL_MS = 1_000;
const HOUSEKEEPING_EVERY_MS = 60_000;

const config = loadConfig();
const log = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  }),
}).child({ service: 'worker' });
const db = createDatabase(config.DATABASE_URL, 5);

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info({ signal }, 'shutting down after the current batch');
    stop.abort();
  });
}

log.info('worker started');
let lastHousekeeping = 0;
while (!stop.signal.aborted) {
  try {
    if (Date.now() - lastHousekeeping >= HOUSEKEEPING_EVERY_MS) {
      const completed = await completeEndedEvents(db);
      if (completed > 0) log.info({ completed }, 'marked ended events completed');
      lastHousekeeping = Date.now();
    }
    const { processed, failed } = await drainOutbox(db, outboxHandlers, { log });
    if (processed + failed > 0) log.info({ processed, failed }, 'outbox batch');
    else await sleep(IDLE_POLL_MS, undefined, { signal: stop.signal }).catch(() => {});
  } catch (err) {
    // Database unreachable and the like: keep the worker alive and try again shortly.
    log.error({ err }, 'worker loop failed');
    await sleep(5 * IDLE_POLL_MS, undefined, { signal: stop.signal }).catch(() => {});
  }
}
await db.destroy();
log.info('worker stopped');
