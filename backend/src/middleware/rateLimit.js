// Rate limiter factory (spec 020 phase 1)
// One place for every per-IP limiter: keyed on the real client IP (the Next
// proxy's signed X-Jump-Client-Ip, else req.ip), env-overridable per name
// (RATE_LIMIT_<NAME>_WINDOW_MS / _LIMIT), metered (rate_limited_total), and
// a pass-through under NODE_ENV=test unless RATE_LIMIT_ENFORCE_IN_TESTS=1 so
// suites that fire hundreds of requests never trip a limit by accident.
//
// In-memory store: production is one backend replica (plan §8 records the
// scale-out condition — a shared store is the change when that stops being true).

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { clientIpForRateLimit } from '../utils/clientIp.js';
import { recordRateLimited } from '../utils/metrics.js';
import logger from '../utils/logger.js';

export { clientIpForRateLimit };

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** True when limiters enforce (always outside tests; in tests only when asked). */
export function limitersEnforced() {
  return process.env.NODE_ENV !== 'test' || process.env.RATE_LIMIT_ENFORCE_IN_TESTS === '1';
}

/**
 * @param {string} name  Upper-snake name used in env overrides, metrics and logs (e.g. ORDER_CREATE)
 * @param {{ windowMs: number, limit: number, message: string, skip?: (req) => boolean, skipSuccessfulRequests?: boolean, skipFailedRequests?: boolean, countStatuses?: number[] }} options
 *   `countStatuses`: count only responses with these status codes (e.g. [401, 403] for
 *   "failed sign-ins"); everything else — including 4xx from the handler itself — is free.
 */
export function makeLimiter(
  name,
  {
    windowMs,
    limit,
    message,
    skip,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    countStatuses = null,
  }
) {
  if (!limitersEnforced()) return (req, res, next) => next();
  const onlyStatuses = Array.isArray(countStatuses) && countStatuses.length > 0;
  return rateLimit({
    ...(onlyStatuses && {
      requestWasSuccessful: (req, res) => !countStatuses.includes(res.statusCode),
    }),
    windowMs: envInt(`RATE_LIMIT_${name}_WINDOW_MS`, windowMs),
    limit: envInt(`RATE_LIMIT_${name}_LIMIT`, limit),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIpForRateLimit(req)),
    ...(skip && { skip }),
    skipSuccessfulRequests: onlyStatuses || skipSuccessfulRequests,
    skipFailedRequests,
    handler: (req, res) => {
      recordRateLimited(name);
      logger.warn('Rate limited', {
        event: 'rate_limited',
        route: name,
        ip: clientIpForRateLimit(req),
        correlationId: req.id,
      });
      res.status(429).json({ error: message });
    },
  });
}

/** Defaults from the spec (plan §2.1); every one overridable through RATE_LIMIT_<NAME>_*. */
export const LIMITS = Object.freeze({
  BASELINE: {
    windowMs: 5 * 60 * 1000,
    limit: 600,
    message: 'Too many requests. Slow down and try again in a few minutes.',
  },
  ORDER_CREATE: {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many checkouts from this address. Try again in a few minutes.',
  },
  ORDER_LOOKUP: {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many lookups from this address. Try again in a few minutes.',
  },
  ORDER_VERIFY: {
    windowMs: 15 * 60 * 1000,
    limit: 60,
    message: 'Too many payment checks from this address. Try again in a few minutes.',
  },
  SCANNER_AUTH: {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many failed scanner sign-ins from this address. Try again in a few minutes.',
  },
  DOMAIN_RESOLVE: {
    windowMs: 60 * 1000,
    limit: 120,
    message: 'Too many requests. Try again in a minute.',
  },
  BUYER_AUTH_REQUEST: {
    windowMs: 60 * 60 * 1000,
    limit: 20,
    message: 'Too many sign-in requests from this address. Try again later.',
  },
  APPLICATION_SUBMIT: {
    windowMs: 60 * 60 * 1000,
    limit: 30,
    message: 'Too many applications from this address. Try again later.',
  },
  // Spec 030: email-change confirmations (request + resend) per IP
  ACCOUNT_EMAIL_CHANGE: {
    windowMs: 60 * 60 * 1000,
    limit: 5,
    message: 'Too many email change requests. Try again later.',
  },
  // Spec 030 B: step-up attempts, WebAuthn ceremonies, password sign-ins, recovery links
  ACCOUNT_REAUTH: {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many verification attempts. Try again in a few minutes.',
  },
  PASSKEY_CEREMONY: {
    windowMs: 15 * 60 * 1000,
    limit: 20,
    message: 'Too many passkey attempts. Try again in a few minutes.',
  },
  PASSWORD_SIGNIN: {
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many sign-in attempts. Try again in a few minutes.',
  },
  ACCOUNT_RECOVERY: {
    windowMs: 60 * 60 * 1000,
    limit: 3,
    message: 'Too many recovery requests. Try again later.',
  },
});

/** Paths the baseline limiter never counts: health, metrics scrape, Stripe webhooks. */
export function baselineSkip(req) {
  const p = req.path || '';
  return p === '/health' || p === '/metrics' || p.startsWith('/webhooks/');
}
