// Revocable staff sessions — the Devices list (spec 030 feature D).
//
// A UserSession row is created by the Auth.js jwt callback when a browser
// signs in (or when a legacy token without `sid` refreshes) and its id rides
// in the JWT as `sid`. requireAuth asks `isRevoked` on every request, so a
// revoked device loses the API at once; the cookie itself is dropped by the
// next claims refresh (≤ 60 s). Raw IPs are never stored.

import { createHash } from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import { cacheGet, cacheSet } from '../utils/cache.js';
import { clientIpForRateLimit } from '../utils/clientIp.js';
import { lookupGeo } from '../utils/geoip.js';
import logger from '../utils/logger.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // the JWT lifetime
const REVOKED_CACHE_TTL_S = 60;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const UA_MAX = 512;

/** Stable, salted hash — no day component, so one device keeps one hash. */
export function hashSessionIp(ip, salt = process.env.LEGAL_IP_SALT || process.env.AUTH_SECRET || '') {
  if (!ip) return null;
  return createHash('sha256').update(`${ip}|session|${salt}`).digest('hex');
}

/** "macOS · Chrome" plus the parsed parts, from a user-agent string. */
export function describeUserAgent(userAgent) {
  if (!userAgent) return { deviceType: null, os: null, browser: null };
  const parsed = UAParser(userAgent);
  const type = parsed.device?.type;
  return {
    deviceType: type === 'mobile' || type === 'tablet' ? type : 'desktop',
    os: parsed.os?.name || null,
    browser: parsed.browser?.name || null,
  };
}

export function deviceLabel({ os, browser }) {
  const parts = [os, browser].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Unknown device';
}

class SessionService {
  constructor() {
    // Process-local first layer in front of Redis: sid → { revoked, expiresAt }
    this._revoked = new Map();
    this._touched = new Map();
  }

  _remember(sid, revoked) {
    this._revoked.set(sid, { revoked, expiresAt: Date.now() + REVOKED_CACHE_TTL_S * 1000 });
    if (this._revoked.size > 10000) this._revoked.clear();
  }

  /** Whether the session behind `sid` has been revoked (or no longer exists). */
  async isRevoked(sid) {
    const local = this._revoked.get(sid);
    if (local && local.expiresAt > Date.now()) return local.revoked;

    const cached = await cacheGet(`session:revoked:${sid}`);
    if (cached && typeof cached.revoked === 'boolean') {
      this._remember(sid, cached.revoked);
      return cached.revoked;
    }

    const row = await prisma.userSession.findUnique({ where: { id: sid }, select: { revokedAt: true } });
    const revoked = !row || row.revokedAt !== null;
    this._remember(sid, revoked);
    await cacheSet(`session:revoked:${sid}`, { revoked }, REVOKED_CACHE_TTL_S);
    return revoked;
  }

  async _markRevoked(sids) {
    for (const sid of sids) {
      this._remember(sid, true);
      await cacheSet(`session:revoked:${sid}`, { revoked: true }, REVOKED_CACHE_TTL_S);
    }
  }

  /**
   * Record activity and fill in device/location from the request, at most
   * once per TOUCH_INTERVAL_MS per session. Fire-and-forget from requireAuth.
   */
  touch(sid, req) {
    const last = this._touched.get(sid) || 0;
    if (Date.now() - last < TOUCH_INTERVAL_MS) return;
    this._touched.set(sid, Date.now());
    if (this._touched.size > 10000) this._touched.clear();

    const userAgent = (req.get('user-agent') || '').slice(0, UA_MAX) || null;
    const ip = clientIpForRateLimit(req);
    void (async () => {
      const geo = await lookupGeo(ip);
      await prisma.userSession.updateMany({
        where: { id: sid, revokedAt: null },
        data: {
          lastSeenAt: new Date(),
          userAgent,
          ...describeUserAgent(userAgent),
          ipHash: hashSessionIp(ip),
          ...(geo ? geo : {}),
        },
      });
    })().catch((error) => logger.warn('Session touch failed', { sid, error: error.message }));
  }

  /** Active sessions for the Devices list, current one first. */
  async list(userId, currentSid) {
    const rows = await prisma.userSession.findMany({
      where: { userId, revokedAt: null, lastSeenAt: { gt: new Date(Date.now() - SESSION_TTL_MS) } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows
      .map((row) => this.toJson(row, currentSid))
      .sort((a, b) => Number(b.current) - Number(a.current));
  }

  toJson(row, currentSid) {
    const location = row.city || row.region || row.country
      ? { city: row.city, region: row.region, country: row.country }
      : null;
    return {
      id: row.id,
      current: row.id === currentSid,
      device: { type: row.deviceType, os: row.os, browser: row.browser, label: deviceLabel(row) },
      provider: row.provider,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      location,
    };
  }

  /** Revoke one of the user's sessions. 404 when it is not theirs. */
  async revoke(userId, sid, by = 'user') {
    const result = await prisma.userSession.updateMany({
      where: { id: sid, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: by },
    });
    if (result.count === 0) {
      const exists = await prisma.userSession.findFirst({ where: { id: sid, userId }, select: { id: true } });
      if (!exists) throw new NotFoundError('Session not found');
    }
    await this._markRevoked([sid]);
    logger.info('Session revoked', { event: 'session_revoked', userId, sid, by });
    return { revoked: result.count };
  }

  /** Revoke every other session. Used by "Log out all other devices" and by password / 2FA changes. */
  async revokeOthers(userId, currentSid, by = 'logout-all') {
    const others = await prisma.userSession.findMany({
      where: { userId, revokedAt: null, ...(currentSid ? { NOT: { id: currentSid } } : {}) },
      select: { id: true },
    });
    if (others.length === 0) return { revoked: 0 };
    await prisma.userSession.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { revokedAt: new Date(), revokedBy: by },
    });
    await this._markRevoked(others.map((o) => o.id));
    logger.info('Other sessions revoked', { event: 'sessions_revoked', userId, count: others.length, by });
    return { revoked: others.length };
  }

  async revokeAll(userId, by) {
    return this.revokeOthers(userId, null, by);
  }

  /** Delete rows that can no longer authenticate: revoked or idle past the JWT lifetime. */
  async sweep(now = new Date()) {
    const cutoff = new Date(now.getTime() - SESSION_TTL_MS);
    const result = await prisma.userSession.deleteMany({
      where: { OR: [{ revokedAt: { lt: cutoff } }, { lastSeenAt: { lt: cutoff } }] },
    });
    if (result.count) logger.info('Session sweep', { event: 'session_sweep', deleted: result.count });
    return { deleted: result.count };
  }
}

export default new SessionService();
