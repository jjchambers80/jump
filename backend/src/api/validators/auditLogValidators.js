// Spec 048: query validation for GET /admin/audit-log and its CSV export.

import { ValidationError } from '../../middleware/errorHandler.js';

const ACTOR_TYPES = new Set(['USER', 'DEVELOPER_TOKEN', 'AGENT', 'SYSTEM']);
const OPERATIONS = new Set(['CREATE', 'UPDATE', 'DELETE', 'BULK_CREATE', 'BULK_UPDATE', 'BULK_DELETE', 'EXPORT', 'OTHER']);
const MAX_LIMIT = 200;
const SHORT = 120;

export const validateAuditLogQuery = (req, res, next) => {
  const q = req.query || {};
  const out = {};
  const present = (key) => q[key] !== undefined && q[key] !== '';

  const offset = present('offset') ? parseInt(q.offset, 10) : 0;
  const limit = present('limit') ? parseInt(q.limit, 10) : 50;
  if (!Number.isInteger(offset) || offset < 0) return next(new ValidationError('offset must be a non-negative integer'));
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return next(new ValidationError(`limit must be an integer from 1 to ${MAX_LIMIT}`));
  out.offset = offset;
  out.limit = limit;

  if (present('actorType')) {
    if (!ACTOR_TYPES.has(q.actorType)) return next(new ValidationError('Unknown actorType'));
    out.actorType = q.actorType;
  }
  if (present('operation')) {
    if (!OPERATIONS.has(q.operation)) return next(new ValidationError('Unknown operation'));
    out.operation = q.operation;
  }
  for (const key of ['actorUserId', 'feature', 'entityType', 'entityId', 'q']) {
    if (!present(key)) continue;
    if (typeof q[key] !== 'string' || q[key].length > SHORT) return next(new ValidationError(`${key} is too long`));
    out[key] = q[key];
  }
  for (const key of ['from', 'to']) {
    if (!present(key)) continue;
    const date = new Date(q[key]);
    if (typeof q[key] !== 'string' || Number.isNaN(date.getTime())) return next(new ValidationError(`${key} must be a date`));
    out[key] = date.toISOString();
  }
  req.auditQuery = out;
  next();
};
