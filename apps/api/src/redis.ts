import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createRedis>;

/** Not connected yet: the caller attaches an error listener before calling connect(). */
export function createRedis(url: string) {
  return createClient({
    url,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 5_000),
    },
  });
}
