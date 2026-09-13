// Domain Service (spec 007 phase 3)
// White-label storefront hostnames: add, verify by DNS, activate, resolve.
//
// Verification contract shown to the organization:
//   CNAME  <hostname>               -> <cnameTarget>
//   TXT    _jump-verify.<hostname>  -> "jump-verify=<verificationToken>"
//
// Lifecycle: PENDING -> VERIFIED (DNS proven) -> ACTIVE (TLS ready, or DNS
// proven when Railway integration is not configured) -> FAILED (72h of
// failed re-checks after having been verified). ACTIVE hostnames drive
// storefront URL generation, CORS, and host->org resolution.

import { promises as dns } from 'dns';
import { randomBytes } from 'crypto';
import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import * as railway from '../lib/railwayDomains.js';

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TXT_PREFIX = 'jump-verify=';
const FAIL_GRACE_MS = 72 * 60 * 60 * 1000;
const RECHECK_ACTIVE_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60 * 1000;

/** Hostnames that belong to the platform itself and can never be claimed. */
function platformHosts() {
  const fromEnv = (process.env.PLATFORM_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const fromUrls = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((u) => { try { return new URL(u.trim()).hostname.toLowerCase(); } catch { return null; } })
    .filter(Boolean);
  return new Set([...fromEnv, ...fromUrls, 'localhost']);
}

/** Default CNAME target: explicit env, else the host of the first FRONTEND_URL. */
function defaultCnameTarget() {
  if (process.env.STOREFRONT_CNAME_TARGET) return process.env.STOREFRONT_CNAME_TARGET.trim().toLowerCase();
  try {
    return new URL((process.env.FRONTEND_URL || 'http://localhost:3001').split(',')[0].trim()).hostname;
  } catch {
    return 'localhost';
  }
}

/**
 * Normalize user input to a bare lowercase hostname. Accepts a URL or a host
 * with port/path; rejects apex domains (CNAME cannot live at an apex on most
 * DNS providers), IPs, and platform hosts.
 */
export function normalizeHostname(input) {
  if (typeof input !== 'string' || !input.trim()) throw new ValidationError('hostname is required');
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split(':')[0].replace(/\.$/, '');
  if (!HOSTNAME_RE.test(host)) throw new ValidationError('Enter a hostname like tickets.example.com');
  if (host.split('.').length < 3) {
    throw new ValidationError('Use a subdomain such as tickets.example.com — apex domains cannot be pointed with a CNAME');
  }
  const platform = platformHosts();
  if (platform.has(host) || [...platform].some((p) => host.endsWith(`.${p}`)) || host.endsWith('.up.railway.app')) {
    throw new ValidationError('That hostname belongs to the platform');
  }
  return host;
}

function stripDot(v) {
  return String(v).toLowerCase().replace(/\.$/, '');
}

class DomainService {
  constructor() {
    this._cache = new Map(); // hostname -> { organizationId|null, expires }
    this._activeCache = { hosts: null, expires: 0 };
    this._dns = dns; // swapped in unit tests
  }

  _invalidate() {
    this._cache.clear();
    this._activeCache = { hosts: null, expires: 0 };
  }

  serialize(d) {
    return {
      id: d.id,
      hostname: d.hostname,
      status: d.status,
      isPrimary: d.isPrimary,
      verifiedAt: d.verifiedAt,
      lastCheckedAt: d.lastCheckedAt,
      lastError: d.lastError,
      createdAt: d.createdAt,
      dnsRecords: [
        { type: 'CNAME', name: d.hostname, value: d.cnameTarget },
        { type: 'TXT', name: `_jump-verify.${d.hostname}`, value: `${TXT_PREFIX}${d.verificationToken}` },
      ],
      tlsManagedByRailway: Boolean(d.railwayDomainId),
    };
  }

  async listForOrganization(organizationId) {
    const rows = await prisma.organizationDomain.findMany({
      where: { organizationId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((d) => this.serialize(d));
  }

  async _ownedDomain(organizationId, id) {
    const d = await prisma.organizationDomain.findFirst({ where: { id, ...(organizationId && { organizationId }) } });
    if (!d) throw new NotFoundError('Domain not found');
    return d;
  }

  /** Register a hostname for an organization. Becomes primary if it is the first. */
  async addDomain(organizationId, input) {
    const hostname = normalizeHostname(input);
    const existing = await prisma.organizationDomain.findUnique({ where: { hostname } });
    if (existing) throw new ConflictError('That hostname is already registered');

    let cnameTarget = defaultCnameTarget();
    let railwayDomainId = null;
    if (railway.isConfigured()) {
      const created = await railway.createCustomDomain(hostname);
      railwayDomainId = created.id;
      if (created.cnameTarget) cnameTarget = stripDot(created.cnameTarget);
    }

    const count = await prisma.organizationDomain.count({ where: { organizationId } });
    const d = await prisma.organizationDomain.create({
      data: {
        organizationId,
        hostname,
        verificationToken: randomBytes(16).toString('hex'),
        cnameTarget,
        railwayDomainId,
        isPrimary: count === 0,
      },
    });
    logger.info('Storefront domain added', { event: 'domain_added', organizationId, hostname, railwayDomainId });
    return this.serialize(d);
  }

  async removeDomain(organizationId, id) {
    const d = await this._ownedDomain(organizationId, id);
    if (d.railwayDomainId) {
      await railway.deleteCustomDomain(d.railwayDomainId).catch((error) => {
        logger.warn('Railway custom domain delete failed; removing locally anyway', { hostname: d.hostname, error: error.message });
      });
    }
    await prisma.organizationDomain.delete({ where: { id: d.id } });
    // Promote the oldest remaining domain if the primary was removed
    if (d.isPrimary) {
      const next = await prisma.organizationDomain.findFirst({ where: { organizationId: d.organizationId }, orderBy: { createdAt: 'asc' } });
      if (next) await prisma.organizationDomain.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    this._invalidate();
    logger.info('Storefront domain removed', { event: 'domain_removed', organizationId: d.organizationId, hostname: d.hostname });
  }

  async setPrimary(organizationId, id) {
    const d = await this._ownedDomain(organizationId, id);
    await prisma.$transaction([
      prisma.organizationDomain.updateMany({ where: { organizationId: d.organizationId, isPrimary: true }, data: { isPrimary: false } }),
      prisma.organizationDomain.update({ where: { id: d.id }, data: { isPrimary: true } }),
    ]);
    this._invalidate();
    return this.serialize(await prisma.organizationDomain.findUnique({ where: { id: d.id } }));
  }

  /** DNS proof: TXT token present and CNAME points at the target. */
  async _checkDns(d) {
    const problems = [];
    try {
      const txt = (await this._dns.resolveTxt(`_jump-verify.${d.hostname}`)).map((chunks) => chunks.join(''));
      if (!txt.some((v) => v.trim() === `${TXT_PREFIX}${d.verificationToken}`)) {
        problems.push(`TXT _jump-verify.${d.hostname} does not contain ${TXT_PREFIX}${d.verificationToken}`);
      }
    } catch (error) {
      problems.push(`TXT _jump-verify.${d.hostname} not found (${error.code || error.message})`);
    }
    try {
      const cnames = (await this._dns.resolveCname(d.hostname)).map(stripDot);
      if (!cnames.includes(stripDot(d.cnameTarget))) {
        problems.push(`CNAME ${d.hostname} points to ${cnames.join(', ') || 'nothing'}; expected ${d.cnameTarget}`);
      }
    } catch (error) {
      problems.push(`CNAME ${d.hostname} not found (${error.code || error.message})`);
    }
    return problems;
  }

  /**
   * Re-check one domain and persist the resulting status.
   * @returns {Promise<object>} serialized domain
   */
  async verifyDomain(organizationId, id) {
    const d = await this._ownedDomain(organizationId, id);
    const now = new Date();
    const problems = await this._checkDns(d);
    const data = { lastCheckedAt: now };

    if (problems.length === 0) {
      data.lastError = null;
      data.failingSince = null;
      data.verifiedAt = d.verifiedAt || now;
      if (d.railwayDomainId) {
        const rs = await railway.getCustomDomainStatus(d.railwayDomainId).catch((error) => {
          logger.warn('Railway status check failed', { hostname: d.hostname, error: error.message });
          return null;
        });
        data.status = rs?.certificateReady ? 'ACTIVE' : 'VERIFIED';
        if (rs && !rs.certificateReady) data.lastError = 'DNS verified; waiting for Railway to issue the certificate';
      } else {
        // No Railway integration: DNS proof is all we can check. TLS must be
        // attached in the Railway dashboard by the operator.
        data.status = 'ACTIVE';
        if (d.status !== 'ACTIVE') {
          logger.warn('Domain activated on DNS proof only; attach it in Railway for TLS', { hostname: d.hostname });
        }
      }
    } else {
      data.lastError = problems.join('. ');
      if (d.verifiedAt) {
        const failingSince = d.failingSince || now;
        data.failingSince = failingSince;
        data.status = now - failingSince >= FAIL_GRACE_MS ? 'FAILED' : d.status; // grace: keep serving
      } else {
        data.status = 'PENDING';
      }
    }

    const updated = await prisma.organizationDomain.update({ where: { id: d.id }, data });
    if (updated.status !== d.status) {
      this._invalidate();
      logger.info('Storefront domain status changed', { event: 'domain_status', hostname: d.hostname, from: d.status, to: updated.status });
    }
    return this.serialize(updated);
  }

  /** Background sweep: pending/verified often, active daily. */
  async checkAll() {
    const now = Date.now();
    const rows = await prisma.organizationDomain.findMany({ where: { status: { in: ['PENDING', 'VERIFIED', 'ACTIVE', 'FAILED'] } } });
    for (const d of rows) {
      const age = now - (d.lastCheckedAt?.getTime() || 0);
      if (d.status === 'ACTIVE' && age < RECHECK_ACTIVE_MS) continue;
      try {
        await this.verifyDomain(null, d.id);
      } catch (error) {
        logger.error('Domain check failed', { hostname: d.hostname, error: error.message });
      }
    }
  }

  /** Host -> organizationId for ACTIVE domains (cached). Null when unknown. */
  async resolveHost(host) {
    if (!host) return null;
    const hostname = stripDot(String(host).split(':')[0]);
    const hit = this._cache.get(hostname);
    if (hit && hit.expires > Date.now()) return hit.organizationId;
    const d = await prisma.organizationDomain.findFirst({
      where: { hostname, status: 'ACTIVE' },
      select: { organizationId: true },
    });
    const organizationId = d?.organizationId || null;
    this._cache.set(hostname, { organizationId, expires: Date.now() + CACHE_TTL_MS });
    return organizationId;
  }

  /** All ACTIVE hostnames (cached), for CORS. */
  async activeHostnames() {
    if (this._activeCache.hosts && this._activeCache.expires > Date.now()) return this._activeCache.hosts;
    const rows = await prisma.organizationDomain.findMany({ where: { status: 'ACTIVE' }, select: { hostname: true } });
    const hosts = new Set(rows.map((r) => r.hostname));
    this._activeCache = { hosts, expires: Date.now() + CACHE_TTL_MS };
    return hosts;
  }

  async isActiveOrigin(origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') return false;
      return (await this.activeHostnames()).has(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /** Primary ACTIVE hostname for an organization, or null. */
  async primaryHostname(organizationId) {
    if (!organizationId) return null;
    const d = await prisma.organizationDomain.findFirst({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { hostname: true },
    });
    return d?.hostname || null;
  }
}

export default new DomainService();
