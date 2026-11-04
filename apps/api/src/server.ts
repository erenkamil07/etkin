import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, pingDatabase } from './db.js';
import { runWorkerLoop } from './outbox/worker-loop.js';
import { createRedis } from './redis.js';

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX);
const redis = createRedis(config.REDIS_URL);

const app = await buildApp({
  config,
  db,
  readinessChecks: {
    postgres: () => pingDatabase(db),
    redis: () => redis.ping(),
  },
});

// One instance can also run the outbox worker (RUN_WORKER_IN_API), which saves
// a separate service on small deployments.
const stopWorker = new AbortController();
let worker: Promise<void> | undefined;

// node-redis crashes the process on an unhandled 'error' event; reconnects are automatic.
redis.on('error', (err) => app.log.warn({ err }, 'redis connection error'));
app.addHook('onClose', async () => {
  // Let the worker finish its batch before the pool it uses goes away.
  stopWorker.abort();
  await worker;
  await Promise.allSettled([db.destroy(), redis.close()]);
});

try {
  await redis.connect();
  await app.listen({ host: config.HOST, port: config.PORT });
  if (config.RUN_WORKER_IN_API) {
    worker = runWorkerLoop(db, app.log.child({ service: 'worker' }), stopWorker.signal);
  }
} catch (err) {
  app.log.fatal({ err }, 'startup failed');
  await app.close();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}
