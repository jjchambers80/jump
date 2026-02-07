// Redis client configuration
// Session storage per FR-021, Constitution deployment standards

import Redis from 'ioredis';
import logger from './logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
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

export default redis;
