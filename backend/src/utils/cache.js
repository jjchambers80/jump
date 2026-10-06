// Cache utility using Redis
// Provides a simple get/set/invalidate caching layer

import redis, { ensureRedisConnecting } from './redis.js';
import logger from './logger.js';

const DEFAULT_TTL = 300; // 5 minutes in seconds
const testCounters = new Map();

/**
 * Whether a command can run right now. The client connects lazily on first
 * use; until it is ready (or while it is down) every call falls open fast
 * instead of queueing behind ioredis retries.
 */
function available() {
  ensureRedisConnecting();
  return redis.status === 'ready';
}

/**
 * Get a cached value by key
 * @param {string} key - Cache key
 * @returns {Promise<Object|null>} Parsed cached value or null
 */
export async function cacheGet(key) {
  if (!available()) return null;
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
  if (!available()) return;
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
  if (!available()) return;
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

/**
 * Atomically increment a fixed-window counter. Agent authorization uses this
 * instead of an IP limiter because provider traffic shares a small IP range.
 * Production uses Redis; tests deliberately use an in-memory fallback.
 * Returns null when the shared store is unavailable so security callers can
 * fail closed rather than silently disabling abuse protection.
 */
export async function cacheIncrement(key, windowMs) {
  if (process.env.NODE_ENV === 'test') {
    const now = Date.now();
    const current = testCounters.get(key);
    const next = !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + windowMs }
      : { ...current, count: current.count + 1 };
    testCounters.set(key, next);
    return next.count;
  }
  if (!available()) return null;
  try {
    return Number(await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      key,
      windowMs,
    ));
  } catch (error) {
    logger.warn('Cache increment error', { key, error: error.message });
    return null;
  }
}

/** Test isolation for fixed-window counters. */
export function resetCacheCountersForTests() {
  if (process.env.NODE_ENV === 'test') testCounters.clear();
}
