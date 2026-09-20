// Redis client configuration
// Session storage per FR-021, Constitution deployment standards
//
// Lazy: nothing connects until the first cache call (utils/cache.js), and
// under test the client never connects, so suites without a Redis on the
// box neither stall on retries nor leave a reconnect loop holding Jest open.

import Redis from 'ioredis';
import logger from './logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  lazyConnect: true,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  logger.error('Redis Client Error', { error: err.message });
});

redis.on('connect', () => {
  logger.info('Redis Client Connected');
});

let connecting = false;
/** Start the connection once; callers check `redis.status === 'ready'` before use. */
export function ensureRedisConnecting() {
  if (process.env.NODE_ENV === 'test' || connecting) return;
  connecting = true;
  redis.connect().catch(() => {});
}

export default redis;
