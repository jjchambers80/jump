// Transactions validators (spec 018 phase 1)
// GET /admin/transactions, GET /admin/transactions/export.csv,
// GET|POST /admin/transactions/:type/:id/refund(s)

import { ValidationError } from '../../middleware/errorHandler.js';
import { TRANSACTION_TYPES, TRANSACTION_STATUSES, TRANSACTION_SORTS } from '../../services/transactionQuery.js';

const MAX_PAGE = 1000;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH = 200;
const MAX_REASON = 500;

function parseIntParam(value, name, { min, max }) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function parseDateParam(value, name) {
  if (value === undefined || value === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${name} must be an ISO 8601 date`);
  return d;
}

function parseBoolParam(value, name) {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  throw new ValidationError(`${name} must be true or false`);
}

/**
 * Normalises the list / export query onto req.transactionQuery. Accepts
 * `limit` as an alias of `pageSize` to match the other admin lists.
 */
export const validateTransactionQuery = (req, res, next) => {
  try {
    const q = req.query || {};
    const out = {};

    if (q.type !== undefined && q.type !== '') {
      const type = String(q.type).toUpperCase();
      if (!TRANSACTION_TYPES.includes(type)) throw new ValidationError(`type must be one of ${TRANSACTION_TYPES.join(', ')}`);
      out.type = type;
    }
    if (q.status !== undefined && q.status !== '') {
      const status = String(q.status).toUpperCase();
      if (!TRANSACTION_STATUSES.includes(status)) throw new ValidationError(`status must be one of ${TRANSACTION_STATUSES.join(', ')}`);
      out.status = status;
    }
    if (q.eventId !== undefined && q.eventId !== '') {
      if (typeof q.eventId !== 'string' || q.eventId.length > 64) throw new ValidationError('eventId must be a string');
      out.eventId = q.eventId;
    }
    out.from = parseDateParam(q.from, 'from');
    out.to = parseDateParam(q.to, 'to');
    if (out.from && out.to && out.from > out.to) throw new ValidationError('from must be before to');
    out.hasRefunds = parseBoolParam(q.hasRefunds, 'hasRefunds');
    if (q.search !== undefined && q.search !== '') {
      const search = String(q.search).trim();
      if (search.length > MAX_SEARCH) throw new ValidationError(`search must be ${MAX_SEARCH} characters or fewer`);
      if (search) out.search = search;
    }
    if (q.sort !== undefined && q.sort !== '') {
      if (!TRANSACTION_SORTS.includes(q.sort)) throw new ValidationError(`sort must be one of ${TRANSACTION_SORTS.join(', ')}`);
      out.sort = q.sort;
    }
    out.page = parseIntParam(q.page, 'page', { min: 1, max: MAX_PAGE });
    out.pageSize = parseIntParam(q.pageSize ?? q.limit, 'pageSize', { min: 1, max: MAX_PAGE_SIZE });

    req.transactionQuery = out;
    next();
  } catch (error) {
    next(error);
  }
};

/** Upper-cases and checks the :type path param. */
export const validateTransactionParams = (req, res, next) => {
  const type = String(req.params.type || '').toUpperCase();
  if (!TRANSACTION_TYPES.includes(type)) return next(new ValidationError(`type must be one of ${TRANSACTION_TYPES.join(', ')}`));
  if (!req.params.id || req.params.id.length > 64) return next(new ValidationError('id is required'));
  req.params.type = type;
  next();
};

/** POST …/refund { amount?, reason? } — same shape as the application refund body. */
export const validateTransactionRefundBody = (req, res, next) => {
  try {
    const body = req.body || {};
    const unknown = Object.keys(body).filter((f) => f !== 'amount' && f !== 'reason');
    if (unknown.length > 0) throw new ValidationError(`Unknown field(s): ${unknown.join(', ')}`);
    if (body.amount !== undefined && body.amount !== null && (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0)) {
      throw new ValidationError('amount must be a positive number');
    }
    if (body.reason !== undefined && body.reason !== null) {
      if (typeof body.reason !== 'string') throw new ValidationError('reason must be a string');
      if (body.reason.length > MAX_REASON) throw new ValidationError(`reason must be ${MAX_REASON} characters or fewer`);
    }
    next();
  } catch (error) {
    next(error);
  }
};
