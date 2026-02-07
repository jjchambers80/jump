// Cache utility using Redis
// Provides a simple get/set/invalidate caching layer

import redis from './redis.js';
import logger from './logger.js';

const DEFAULT_TTL = 300; // 5 minutes in seconds

/**
 * Get a cached value by key
 * @param {string} key - Cache key
 * @returns {Promise<Object|null>} Parsed cached value or null
 */
export async function cacheGet(key) {
  try {
    const cached = await redis.get(key);
    if (cached) {
      logger.debug('Cache hit', { key });
      return JSON.parse(cached);
    }
    logger.debug('Cache miss', { key });
    return null;
  } catch (error) {
    logger.warn('Cache get error', { key, error: error.message });
    return null; // Fail open - return null so the caller fetches from DB
  }
}

/**
 * Set a cached value with TTL
 * @param {string} key - Cache key
 * @param {Object} value - Value to cache (will be JSON-serialized)
 * @param {number} ttl - Time-to-live in seconds (default: 300)
 */
export async function cacheSet(key, value, ttl = DEFAULT_TTL) {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
    logger.debug('Cache set', { key, ttl });
  } catch (error) {
    logger.warn('Cache set error', { key, error: error.message });
    // Fail silently - caching is non-critical
  }
}

/**
 * Invalidate cached values by pattern
 * @param {string} pattern - Glob pattern for keys to invalidate (e.g., 'events:*')
 */
export async function cacheInvalidate(pattern) {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug('Cache invalidated', { pattern, count: keys.length });
    }
  } catch (error) {
    logger.warn('Cache invalidation error', { pattern, error: error.message });
  }
}
