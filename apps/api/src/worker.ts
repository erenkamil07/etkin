// Background worker as its own process. Small deployments can run the same
// loop inside the API instead (RUN_WORKER_IN_API); see outbox/worker-loop.ts.
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { runWorkerLoop } from './outbox/worker-loop.js';

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

await runWorkerLoop(db, log, stop.signal);
await db.destroy();
