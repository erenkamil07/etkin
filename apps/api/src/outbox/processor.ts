import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db.js';

/** Handlers run inside the transaction that marks the event processed, so their writes commit with it. */
export type OutboxHandler = (db: Database, payload: unknown) => Promise<void>;
export type OutboxHandlers = Record<string, OutboxHandler>;

type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

/** 2 s, 4 s, 8 s, ... capped at an hour. */
export function retryDelayMs(attempts: number) {
  return Math.min(1000 * 2 ** attempts, MAX_RETRY_DELAY_MS);
}

/**
 * Claims and handles the oldest due event. FOR UPDATE SKIP LOCKED lets any
 * number of workers drain the table side by side without ever handling the
 * same row at the same time. A failing handler rolls back its own writes and
 * the row is retried later with backoff.
 */
export async function processNextOutboxEvent(
  db: Database,
  handlers: OutboxHandlers,
  log?: Logger,
): Promise<'processed' | 'failed' | 'idle'> {
  let claimed: { id: string; topic: string; attempts: number } | undefined;
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('outbox')
        .select(['id', 'topic', 'payload', 'attempts'])
        .where('processed_at', 'is', null)
        .where('available_at', '<=', new Date())
        .orderBy('id')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!row) return 'idle';
      claimed = { id: String(row.id), topic: row.topic, attempts: row.attempts };

      const handler = handlers[row.topic];
      if (handler) await handler(trx, row.payload);
      else log?.warn({ topic: row.topic, id: claimed.id }, 'no handler for outbox topic; marking processed');

      await trx
        .updateTable('outbox')
        .set({ processed_at: new Date(), attempts: row.attempts + 1 })
        .where('id', '=', row.id)
        .execute();
      return 'processed';
    });
  } catch (err) {
    if (!claimed) throw err;
    const attempts = claimed.attempts + 1;
    log?.error({ err, id: claimed.id, topic: claimed.topic, attempts }, 'outbox handler failed; will retry');
    await db
      .updateTable('outbox')
      .set({
        attempts,
        last_error: String(err).slice(0, 1000),
        available_at: new Date(Date.now() + retryDelayMs(attempts)),
      })
      .where('id', '=', claimed.id)
      .execute();
    return 'failed';
  }
}

/** Handles due events until none are left or `max` have been tried. */
export async function drainOutbox(
  db: Database,
  handlers: OutboxHandlers,
  { max = 100, log }: { max?: number; log?: Logger } = {},
) {
  let processed = 0;
  let failed = 0;
  while (processed + failed < max) {
    const outcome = await processNextOutboxEvent(db, handlers, log);
    if (outcome === 'idle') break;
    if (outcome === 'processed') processed++;
    else failed++;
  }
  return { processed, failed };
}
