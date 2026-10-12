import { ValidationError } from '../../middleware/errorHandler.js';
import { normalizeFilters } from '../../services/contactListFilters.js';

const nameOk = (name) => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80;
const fail = (field, message) => new ValidationError('Validation failed', [{ field, message }]);

/** POST /admin/contact-lists — filters are cleaned in place (unknown keys 400). */
export function validateCreateList(req, res, next) {
  const body = req.body || {};
  if (!nameOk(body.name)) return next(fail('name', 'name must be 1–80 characters'));
  if (!['AUTOMATIC', 'MANUAL'].includes(body.type)) return next(fail('type', 'type must be AUTOMATIC or MANUAL'));
  if (body.type === 'MANUAL' && body.filters !== undefined && body.filters !== null) {
    return next(fail('filters', 'a manual list has no filters'));
  }
  try {
    if (body.type === 'AUTOMATIC') body.filters = normalizeFilters(body.filters);
  } catch (error) {
    return next(error);
  }
  next();
}

/** PATCH /admin/contact-lists/:listId — only the keys present; the type never changes. */
export function validateUpdateList(req, res, next) {
  const body = req.body || {};
  const unknown = Object.keys(body).filter((key) => !['name', 'filters'].includes(key));
  if (unknown.length) return next(fail(unknown[0], `${unknown[0]} cannot be changed`));
  if (body.name !== undefined && !nameOk(body.name)) return next(fail('name', 'name must be 1–80 characters'));
  try {
    if (body.filters !== undefined) body.filters = normalizeFilters(body.filters);
  } catch (error) {
    return next(error);
  }
  next();
}

/** POST /admin/contact-lists/preview */
export function validatePreview(req, res, next) {
  try {
    req.body = { filters: normalizeFilters(req.body?.filters) };
  } catch (error) {
    return next(error);
  }
  next();
}

/** POST | DELETE /admin/contact-lists/:listId/members — { contactIds: [id, …] }, 1–500. */
export function validateMembers(req, res, next) {
  const ids = req.body?.contactIds;
  const ok =
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= 500 &&
    ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64);
  if (!ok) return next(fail('contactIds', 'contactIds must be a list of 1–500 contact ids'));
  next();
}
