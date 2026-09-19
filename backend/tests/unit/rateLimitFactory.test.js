// Unit tests for the spec 020 limiter factory: pass-through under test
// unless enforced, env overrides, the signed-IP key, skip rules and the 429
// body / metric.

import { jest } from '@jest/globals';
import { createHmac } from 'crypto';
import express from 'express';
import request from 'supertest';

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
const recordRateLimited = jest.fn();
jest.unstable_mockModule('../../src/utils/metrics.js', () => ({ recordRateLimited }));

const { makeLimiter, limitersEnforced, LIMITS, baselineSkip } =
  await import('../../src/middleware/rateLimit.js');

const sign = (ip) => createHmac('sha256', process.env.AUTH_SECRET).update(ip).digest('hex');

function appWith(limiter, handler = (req, res) => res.json({ ok: true })) {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/t', limiter, handler);
  return app;
}

describe('makeLimiter', () => {
  const envBackup = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in envBackup)) delete process.env[k];
    Object.assign(process.env, envBackup);
    recordRateLimited.mockClear();
  });

  test('is a pass-through under NODE_ENV=test unless RATE_LIMIT_ENFORCE_IN_TESTS=1', async () => {
    delete process.env.RATE_LIMIT_ENFORCE_IN_TESTS;
    expect(limitersEnforced()).toBe(false);
    const app = appWith(makeLimiter('X', { windowMs: 60_000, limit: 1, message: 'no' }));
    for (let i = 0; i < 5; i += 1) expect((await request(app).post('/t')).status).toBe(200);
    process.env.RATE_LIMIT_ENFORCE_IN_TESTS = '1';
    expect(limitersEnforced()).toBe(true);
  });

  test('enforced: the limit applies per client IP, the 429 carries the message and standard headers, the metric counts the route', async () => {
    process.env.RATE_LIMIT_ENFORCE_IN_TESTS = '1';
    const app = appWith(
      makeLimiter('ORDER_CREATE_T', { windowMs: 60_000, limit: 2, message: 'Too many checkouts.' })
    );
    const a = () => request(app).post('/t').set('X-Forwarded-For', '203.0.113.1');
    const b = () => request(app).post('/t').set('X-Forwarded-For', '203.0.113.2');
    expect((await a()).status).toBe(200);
    expect((await a()).status).toBe(200);
    const third = await a();
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: 'Too many checkouts.' });
    expect(third.headers['ratelimit-limit'] ?? third.headers['ratelimit']).toBeDefined();
    expect((await b()).status).toBe(200); // another address has its own budget
    expect(recordRateLimited).toHaveBeenCalledWith('ORDER_CREATE_T');
  });

  test('keys on the signed X-Jump-Client-Ip when present, so two proxied buyers do not share a budget', async () => {
    process.env.RATE_LIMIT_ENFORCE_IN_TESTS = '1';
    const app = appWith(makeLimiter('KEY_T', { windowMs: 60_000, limit: 1, message: 'no' }));
    const proxied = (ip) =>
      request(app).post('/t').set('X-Jump-Client-Ip', ip).set('X-Jump-Client-Ip-Sig', sign(ip));
    expect((await proxied('198.51.100.1')).status).toBe(200);
    expect((await proxied('198.51.100.2')).status).toBe(200);
    expect((await proxied('198.51.100.1')).status).toBe(429);
    // Unsigned header is ignored: keyed on the socket address instead
    const unsigned = (ip) => request(app).post('/t').set('X-Jump-Client-Ip', ip);
    expect((await unsigned('198.51.100.3')).status).toBe(200);
    expect((await unsigned('198.51.100.4')).status).toBe(429);
  });

  test('RATE_LIMIT_<NAME>_LIMIT and _WINDOW_MS override the defaults; garbage is ignored', async () => {
    process.env.RATE_LIMIT_ENFORCE_IN_TESTS = '1';
    process.env.RATE_LIMIT_ENV_T_LIMIT = '3';
    process.env.RATE_LIMIT_ENV_T_WINDOW_MS = 'not-a-number';
    const app = appWith(makeLimiter('ENV_T', { windowMs: 60_000, limit: 1, message: 'no' }));
    for (let i = 0; i < 3; i += 1) expect((await request(app).post('/t')).status).toBe(200);
    expect((await request(app).post('/t')).status).toBe(429);
  });

  test('skipSuccessfulRequests counts failures only; skipFailedRequests counts successes only', async () => {
    process.env.RATE_LIMIT_ENFORCE_IN_TESTS = '1';
    const failures = appWith(
      makeLimiter('SCAN_T', {
        windowMs: 60_000,
        limit: 2,
        message: 'no',
        skipSuccessfulRequests: true,
      }),
      (req, res) => res.status(req.get('x-ok') ? 200 : 401).end()
    );
    for (let i = 0; i < 5; i += 1)
      expect((await request(failures).post('/t').set('x-ok', '1')).status).toBe(200);
    expect((await request(failures).post('/t')).status).toBe(401);
    expect((await request(failures).post('/t')).status).toBe(401);
    expect((await request(failures).post('/t')).status).toBe(429);

    const successes = appWith(
      makeLimiter('ORDER_T', {
        windowMs: 60_000,
        limit: 2,
        message: 'no',
        skipFailedRequests: true,
      }),
      (req, res) => res.status(req.get('x-ok') ? 201 : 400).end()
    );
    for (let i = 0; i < 5; i += 1) expect((await request(successes).post('/t')).status).toBe(400);
    expect((await request(successes).post('/t').set('x-ok', '1')).status).toBe(201);
    expect((await request(successes).post('/t').set('x-ok', '1')).status).toBe(201);
    expect((await request(successes).post('/t').set('x-ok', '1')).status).toBe(429);
  });

  test('defaults match the spec and the baseline skips health, metrics and webhooks', () => {
    expect(LIMITS.ORDER_CREATE).toMatchObject({ windowMs: 15 * 60 * 1000, limit: 10 });
    expect(LIMITS.BASELINE).toMatchObject({ windowMs: 5 * 60 * 1000, limit: 600 });
    expect(LIMITS.SCANNER_AUTH.limit).toBe(10);
    expect(LIMITS.DOMAIN_RESOLVE).toMatchObject({ windowMs: 60 * 1000, limit: 120 });
    expect(baselineSkip({ path: '/health' })).toBe(true);
    expect(baselineSkip({ path: '/metrics' })).toBe(true);
    expect(baselineSkip({ path: '/webhooks/stripe' })).toBe(true);
    expect(baselineSkip({ path: '/orders' })).toBe(false);
  });
});
