import { ValidationError } from '../../middleware/errorHandler.js';

const HTML_TAG = /<\/?[a-z][^>]*>/i;

export function normalizeCommentBody(value) {
  if (typeof value !== 'string') throw new ValidationError('Comment body is required');
  const body = value.trim();
  if (!body) throw new ValidationError('Comment body is required');
  if (body.length > 2000)
    throw new ValidationError('Comment body must be 2000 characters or fewer');
  if (HTML_TAG.test(body)) throw new ValidationError('Comment body must be plain text');
  return body;
}

export function validateCreateCustomerComment(req, _res, next) {
  try {
    const keys = Object.keys(req.body || {});
    if (keys.some((key) => key !== 'body')) throw new ValidationError('Unknown comment field');
    req.body = { body: normalizeCommentBody(req.body?.body) };
    next();
  } catch (error) {
    next(error);
  }
}

export function timelineQuery(req) {
  const rawLimit = Number.parseInt(req.query?.limit, 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
  if (limit < 1 || limit > 100) throw new ValidationError('limit must be between 1 and 100');
  const cursor = req.query?.cursor;
  if (cursor !== undefined && typeof cursor !== 'string')
    throw new ValidationError('Invalid timeline cursor');
  return { limit, cursor };
}
