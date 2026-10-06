// Append-only, privacy-minimising agent call audit writer (spec 045).

import { createHash } from 'node:crypto';
import { prisma } from '@jump/db';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function argsDigest(args) {
  const serialized = JSON.stringify(canonical(args ?? null));
  return createHash('sha256').update(serialized).digest('hex');
}

export function redactAuditSummary(summary) {
  return String(summary ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:jmp_|oauth_|access_|refresh_)[A-Za-z0-9._~-]{12,}\b/g, '[redacted-token]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[redacted-number]')
    .slice(0, 500);
}

class AgentAuditService {
  async write({ authorization, tool, args, summary, outcome, targetType = null, targetId = null }) {
    if (!authorization?.organizationId || !authorization?.userId || !authorization?.grantId) {
      throw new TypeError('A successful agent authorization is required for audit attribution');
    }
    return prisma.agentAuditLog.create({
      data: {
        organizationId: authorization.organizationId,
        userId: authorization.userId,
        grantId: authorization.grantId,
        clientName: authorization.clientName,
        tool,
        argsDigest: argsDigest(args),
        summary: redactAuditSummary(summary),
        outcome,
        targetType,
        targetId,
      },
    });
  }
}

export default new AgentAuditService();
