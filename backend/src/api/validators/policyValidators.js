import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { POLICY_TYPE_KEYS } from '../../config/policyTemplates.js';

const TITLE_MAX = 200;
const CONTENT_MAX = 200_000;

/** `:type` is one of the written policies (spec 052); 404 otherwise. */
export function validatePolicyType(req, res, next) {
  if (!POLICY_TYPE_KEYS.includes(req.params.type)) {
    return next(new NotFoundError('Policy not found'));
  }
  next();
}

/** PUT /admin/settings/policies/:type { title, content } */
export function validateSavePolicy(req, res, next) {
  const { title, content } = req.body || {};
  const errors = [];
  if (typeof title !== 'string' || !title.trim() || title.trim().length > TITLE_MAX) {
    errors.push({ field: 'title', message: `Title is required (at most ${TITLE_MAX} characters)` });
  }
  if (typeof content !== 'string' || !content.trim() || content.length > CONTENT_MAX) {
    errors.push({ field: 'content', message: 'Policy text is required' });
  }
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  req.body = { title, content };
  next();
}

/** PATCH /admin/settings/policies { showInFooter } */
export function validatePolicySettings(req, res, next) {
  if (typeof req.body?.showInFooter !== 'boolean') {
    return next(new ValidationError('Validation failed', [{ field: 'showInFooter', message: 'showInFooter must be a boolean' }]));
  }
  next();
}
