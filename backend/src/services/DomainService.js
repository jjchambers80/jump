// Domain Service (spec 007 phase 3, setup page data in spec 008)
// White-label storefront hostnames: add, verify by DNS, activate, resolve.
//
// Verification contract shown to the organization:
//   CNAME  <hostname>                        -> <cnameTarget>
//   TXT    <verificationHost>.<hostname>     -> <verificationToken>
// Without Railway: verificationHost is "_jump-verify" and the token is
// "jump-verify=<hex>". With Railway configured, Railway's own record
// ("_railway-verify" / "railway-verify=<token>") is stored instead, so the
// organization publishes two records, not three, and Railway's ownership
// check and ours can never disagree.
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
import { detectDnsProvider, providerInfo } from '../lib/dnsProvider.js';

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const JUMP_TXT_HOST = '_jump-verify';
const JUMP_TXT_PREFIX = 'jump-verify=';
const FAIL_GRACE_MS = 72 * 60 * 60 * 1000;
const RECHECK_ACTIVE_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60 * 1000;
// Second-level labels under which the registrable zone has three labels (example.co.uk).
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

/** User-initiated re-checks closer together than this return the last result (the sweep is exempt). */
function verifyCooldownMs() {
  const raw = process.env.DOMAIN_VERIFY_COOLDOWN_MS;
  return raw === undefined ? 15 * 1000 : Math.max(0, Number(raw) || 0);
}

/** Hostnames that belong to the platform itself and can never be claimed. */
function platformHosts() {
  const fromEnv = (process.env.PLATFORM_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const fromUrls = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((u) => { try { return new URL(u.trim()).hostname.toLowerCase(); } catch { return null; } })
    .filter(Boolean);
  return new Set([...fromEnv, ...fromUrls, 'localhost']);
}

/** Public platform base URL (first FRONTEND_URL), for the "Jump URL" row. */
function platformBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3001').split(',')[0].trim().replace(/\/$/, '');
}

/** Default CNAME target: explicit env, else the host of the first FRONTEND_URL. */
function defaultCnameTarget() {
  if (process.env.STOREFRONT_CNAME_TARGET) return process.env.STOREFRONT_CNAME_TARGET.trim().toLowerCase();
  try {
    return new URL(platformBaseUrl()).hostname;
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

/** Registrable zone of a hostname (example.com, example.co.uk). Naive public-suffix rule. */
export function zoneOf(hostname) {
  const labels = String(hostname).toLowerCase().split('.');
  if (labels.length <= 2) return labels.join('.');
  const n = labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join('.');
}

/**
 * Reduce a DNS host label as returned by Railway to the prefix that goes in
 * front of our hostname. Accepts a FQDN ("_railway-verify.tickets.example.com"),
 * a zone-relative name ("_railway-verify.tickets") or a bare prefix.
 */
export function txtPrefixFor(hostlabel, hostname) {
  const h = stripDot(hostlabel);
  if (h.endsWith(`.${hostname}`)) return h.slice(0, -(hostname.length + 1));
  const hl = h.split('.');
  const nl = hostname.split('.');
  for (let k = Math.min(hl.length - 1, nl.length); k > 0; k--) {
    if (hl.slice(-k).join('.') === nl.slice(0, k).join('.')) return hl.slice(0, -k).join('.');
  }
  return h;
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
    const snapshot = d.lastDnsSnapshot || {};
    const record = (key, type, name, value) => ({
      key,
      type,
      name,
      value,
      currentValue: snapshot[key]?.currentValue ?? null,
      status: snapshot[key]?.status ?? 'pending',
    });
    return {
      id: d.id,
      hostname: d.hostname,
      zone: zoneOf(d.hostname),
      status: d.status,
      isPrimary: d.isPrimary,
      verifiedAt: d.verifiedAt,
      lastCheckedAt: d.lastCheckedAt,
      failingSince: d.failingSince ?? null,
      lastError: d.lastError,
      createdAt: d.createdAt,
      dnsRecords: [
        record('cname', 'CNAME', d.hostname, d.cnameTarget),
        record('txt', 'TXT', `${d.verificationHost || JUMP_TXT_HOST}.${d.hostname}`, d.verificationToken),
      ],
      tlsManagedByRailway: Boolean(d.railwayDomainId),
      certificateStatus: d.railwayDomainId ? d.certificateStatus || 'PENDING' : null,
      dnsProvider: providerInfo(d.dnsProvider),
    };
  }

  /** Platform storefront URL for an organization (the row that is always "connected"). */
  platformUrlFor(organizationId) {
    return `${platformBaseUrl()}/organizations/${organizationId}`;
  }

  async listForOrganization(organizationId) {
    const rows = await prisma.organizationDomain.findMany({
      where: { organizationId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((d) => this.serialize(d));
  }

  async getForOrganization(organizationId, id) {
    return this.serialize(await this._ownedDomain(organizationId, id));
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
    let verificationHost = JUMP_TXT_HOST;
    let verificationToken = `${JUMP_TXT_PREFIX}${randomBytes(16).toString('hex')}`;
    if (railway.isConfigured()) {
      let created;
      try {
        created = await railway.createCustomDomain(hostname);
      } catch (error) {
        // Plan limits (Hobby: 2 domains per service) and invalid hosts come back here
        logger.warn('Railway custom domain create failed', { hostname, error: error.message });
        throw new ValidationError(`Could not register the domain with the hosting provider: ${error.message.replace(/^Railway API: /, '')}`);
      }
      railwayDomainId = created.id;
      if (created.cnameTarget) cnameTarget = stripDot(created.cnameTarget);
      if (created.txtHost && created.txtValue) {
        verificationHost = txtPrefixFor(created.txtHost, hostname);
        verificationToken = created.txtValue.trim();
      } else {
        logger.warn('Railway returned no TXT record; falling back to _jump-verify (Railway may 404 until its TXT is added)', { hostname });
      }
    }

    // Resolver is swapped in tests and may not implement resolveNs; detection is optional.
    const dnsProvider = typeof this._dns.resolveNs === 'function' ? await detectDnsProvider(hostname, this._dns) : null;

    const count = await prisma.organizationDomain.count({ where: { organizationId } });
    const d = await prisma.organizationDomain.create({
      data: {
        organizationId,
        hostname,
        verificationHost,
        verificationToken,
        cnameTarget,
        railwayDomainId,
        dnsProvider,
        isPrimary: count === 0,
      },
    });
    logger.info('Storefront domain added', { event: 'domain_added', organizationId, hostname, railwayDomainId, dnsProvider });
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

  /**
   * DNS proof: TXT token present and CNAME points at the target.
   * @returns {{ problems: string[], snapshot: { txt: object, cname: object } }}
   */
  async _checkDns(d) {
    const problems = [];
    const txtName = `${d.verificationHost || JUMP_TXT_HOST}.${d.hostname}`;
    const snapshot = { txt: { currentValue: null, status: 'missing' }, cname: { currentValue: null, status: 'missing' } };

    try {
      const txt = (await this._dns.resolveTxt(txtName)).map((chunks) => chunks.join(''));
      const match = txt.find((v) => v.trim() === d.verificationToken);
      snapshot.txt.currentValue = match ?? txt[0] ?? null;
      if (match) {
        snapshot.txt.status = 'valid';
      } else {
        snapshot.txt.status = txt.length ? 'invalid' : 'missing';
        problems.push(`TXT ${txtName} does not contain ${d.verificationToken}`);
      }
    } catch (error) {
      problems.push(`TXT ${txtName} not found (${error.code || error.message})`);
    }

    try {
      const cnames = (await this._dns.resolveCname(d.hostname)).map(stripDot);
      snapshot.cname.currentValue = cnames[0] ?? null;
      if (cnames.includes(stripDot(d.cnameTarget))) {
        snapshot.cname.status = 'valid';
      } else {
        snapshot.cname.status = cnames.length ? 'invalid' : 'missing';
        problems.push(`CNAME ${d.hostname} points to ${cnames.join(', ') || 'nothing'}; expected ${d.cnameTarget}`);
      }
    } catch (error) {
      problems.push(`CNAME ${d.hostname} not found (${error.code || error.message})`);
    }
    return { problems, snapshot };
  }

  /**
   * Re-check one domain and persist the resulting status. User-initiated
   * checks (organizationId given) inside the cooldown window return the
   * stored row unchanged; the background sweep passes null and always checks.
   * @returns {Promise<object>} serialized domain
   */
  async verifyDomain(organizationId, id) {
    const d = await this._ownedDomain(organizationId, id);
    const now = new Date();
    if (organizationId && d.lastCheckedAt && now - d.lastCheckedAt < verifyCooldownMs()) {
      return this.serialize(d);
    }

    const { problems, snapshot } = await this._checkDns(d);
    const data = { lastCheckedAt: now, lastDnsSnapshot: snapshot };

    if (problems.length === 0) {
      data.lastError = null;
      data.failingSince = null;
      data.verifiedAt = d.verifiedAt || now;
      if (d.railwayDomainId) {
        const rs = await railway.getCustomDomainStatus(d.railwayDomainId).catch((error) => {
          logger.warn('Railway status check failed', { hostname: d.hostname, error: error.message });
          return null;
        });
        if (rs) data.certificateStatus = rs.certificateStatus;
        data.status = rs?.certificateReady ? 'ACTIVE' : 'VERIFIED';
        if (rs && !rs.certificateReady) {
          data.lastError = rs.certificateStatus === 'FAILED'
            ? 'DNS verified, but the certificate could not be issued. Check that the hostname is not proxied and try again.'
            : 'DNS verified; waiting for Railway to issue the certificate';
        }
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
