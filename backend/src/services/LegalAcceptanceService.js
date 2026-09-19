// Legal Acceptance Service (spec 023 §8.1 / LR-05, built by spec 024 phase 3)
// Writes the append-only consent trail: who accepted which document version,
// when, from where. The backend is the only writer; clients send the
// versions they showed and the server checks them against LEGAL_VERSIONS.

import { createHash } from 'node:crypto';
import { prisma } from '@jump/db';
import { ValidationError } from '../middleware/errorHandler.js';
import { DOCUMENT_FOR_KEY, KEY_FOR_DOCUMENT, LEGAL_VERSIONS } from '../config/legal.js';
import { clientIpForRateLimit } from '../utils/clientIp.js';

const MAX_ACCEPTANCES = 10;

/** sha256(ip + UTC day + salt): stable within a day for the same address, never the raw IP. */
export function hashIp(
  ip,
  { salt = process.env.LEGAL_IP_SALT || process.env.AUTH_SECRET || '', now = new Date() } = {}
) {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  return createHash('sha256').update(`${ip}|${day}|${salt}`).digest('hex');
}

/** What the request tells us about the person accepting: hashed IP and a truncated user agent. */
export function requestMeta(req) {
  if (!req) return { ipHash: null, userAgent: null };
  const ua = req.get?.('user-agent') || null;
  return {
    ipHash: hashIp(clientIpForRateLimit(req)),
    userAgent: ua ? String(ua).slice(0, 255) : null,
  };
}

class LegalAcceptanceService {
  /** Current versions, as `GET /legal/versions` returns them. */
  versions() {
    return { ...LEGAL_VERSIONS };
  }

  /**
   * Validate a client's `acceptances` against the required documents and the
   * current versions. Returns the normalised list `[{ document, version }]`.
   * - missing or malformed → 400 LEGAL_ACCEPTANCE_REQUIRED
   * - a required document absent → 400 LEGAL_ACCEPTANCE_REQUIRED
   * - a version that is not current → 400 LEGAL_VERSION_STALE (the client reloads the versions)
   * Extra documents this config does not know are refused.
   */
  assertCurrent(acceptances, required = ['TERMS', 'PRIVACY']) {
    if (!Array.isArray(acceptances))
      throw this._error(
        'LEGAL_ACCEPTANCE_REQUIRED',
        'acceptances must be a list of { document, version }'
      );
    if (acceptances.length > MAX_ACCEPTANCES)
      throw this._error('LEGAL_ACCEPTANCE_REQUIRED', 'Too many acceptances');
    const seen = new Map();
    for (const a of acceptances) {
      const document = typeof a?.document === 'string' ? a.document.toUpperCase() : '';
      const key = KEY_FOR_DOCUMENT[document];
      if (!key)
        throw this._error(
          'LEGAL_ACCEPTANCE_REQUIRED',
          `Unknown legal document: ${a?.document ?? ''}`
        );
      const version = typeof a?.version === 'string' ? a.version : '';
      if (version !== LEGAL_VERSIONS[key])
        throw this._error(
          'LEGAL_VERSION_STALE',
          `The ${document.toLowerCase().replace('_', ' ')} you accepted is out of date; reload and try again`
        );
      seen.set(document, { document, version });
    }
    for (const document of required) {
      if (!seen.has(document))
        throw this._error(
          'LEGAL_ACCEPTANCE_REQUIRED',
          `Please accept the ${document === 'CARD_AUTHORIZATION' ? 'card authorization' : document.toLowerCase()} to continue`
        );
    }
    // Only what this step requires is recorded; an extra known document is
    // checked for staleness but not written (a FREE form never records a card authorization).
    return required.map((document) => seen.get(document));
  }

  /**
   * Record one acceptance per document inside `tx`.
   * @param {import('@prisma/client').Prisma.TransactionClient} tx
   * @param {{ subjectType: 'USER'|'CONTACT'|'ANONYMOUS_EMAIL', subjectId?: string|null, email: string, organizationId?: string|null, source: string, referenceType?: string, referenceId?: string, ipHash?: string|null, userAgent?: string|null, presentedText?: Record<string,string> }} params
   * @param {Array<{ document: string, version: string }>} acceptances
   */
  async record(
    tx,
    {
      subjectType,
      subjectId = null,
      email,
      organizationId = null,
      source,
      referenceType = null,
      referenceId = null,
      ipHash = null,
      userAgent = null,
      presentedText = {},
    },
    acceptances
  ) {
    if (!acceptances?.length) return [];
    return tx.legalAcceptance.createManyAndReturn({
      data: acceptances.map((a) => ({
        subjectType,
        subjectId,
        email: String(email || '').toLowerCase(),
        organizationId,
        document: a.document,
        version: a.version,
        source,
        referenceType,
        referenceId,
        ipHash,
        userAgent,
        presentedText: presentedText[a.document] ?? null,
      })),
    });
  }

  /** Acceptances tied to a reference (an order, an application), oldest first. */
  async forReference(referenceType, referenceId) {
    return prisma.legalAcceptance.findMany({
      where: { referenceType, referenceId },
      orderBy: { acceptedAt: 'asc' },
    });
  }

  _error(code, message) {
    const error = new ValidationError(message);
    error.code = code;
    return error;
  }
}

export { DOCUMENT_FOR_KEY };
export default new LegalAcceptanceService();
