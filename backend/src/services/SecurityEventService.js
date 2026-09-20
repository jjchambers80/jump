// Append-only audit trail of account security mutations (spec 030).
// Never records secrets; the IP is hashed like LegalAcceptance.

import { prisma } from '@jump/db';
import { hashIp } from './LegalAcceptanceService.js';
import { clientIpForRateLimit } from '../utils/clientIp.js';
import logger from '../utils/logger.js';

const UA_MAX = 512;

export function requestMeta(req) {
  if (!req) return { ipHash: null, userAgent: null };
  return {
    ipHash: hashIp(clientIpForRateLimit(req)),
    userAgent: (req.get && req.get('user-agent') ? String(req.get('user-agent')).slice(0, UA_MAX) : null) || null,
  };
}

class SecurityEventService {
  /**
   * @param {string} userId
   * @param {string} type  e.g. SESSION_REVOKED, SESSIONS_REVOKED_ALL
   * @param {{ req?: import('express').Request, meta?: object }} [options]
   */
  async record(userId, type, { req, meta } = {}) {
    try {
      await prisma.securityEvent.create({
        data: { userId, type, ...requestMeta(req), meta: meta ?? undefined },
      });
    } catch (error) {
      // The audit row must never break the action it describes.
      logger.warn('Security event not recorded', { userId, type, error: error.message });
    }
  }

  async listForUser(userId, limit = 50) {
    return prisma.securityEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
  }
}

export default new SecurityEventService();
