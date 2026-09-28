// Spec 038 theme routes: request shape only. ThemeService validates the
// content itself (@jump/theme) inside the save transaction.

import { ValidationError } from '../../middleware/errorHandler.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isVersion = (v, min) => Number.isInteger(v) && v >= min;
const MAX_DOCUMENTS_PER_SAVE = 20;

/** PUT /admin/themes/:id/save — contracts C5. */
export function validateThemeSave(req, res, next) {
  const body = req.body || {};
  const errors = [];
  if (!isVersion(body.themeVersion, 1)) errors.push({ field: 'themeVersion', message: 'themeVersion is required' });
  if (body.settings !== undefined && !isObject(body.settings))
    errors.push({ field: 'settings', message: 'settings must be an object' });
  if (body.content !== undefined && !isObject(body.content))
    errors.push({ field: 'content', message: 'content must be an object' });
  if (body.documents !== undefined) {
    if (!isObject(body.documents)) errors.push({ field: 'documents', message: 'documents must be an object' });
    else {
      const entries = Object.entries(body.documents);
      if (entries.length > MAX_DOCUMENTS_PER_SAVE)
        errors.push({ field: 'documents', message: `at most ${MAX_DOCUMENTS_PER_SAVE} documents per save` });
      for (const [key, doc] of entries) {
        if (!isObject(doc) || !(doc.data === null || isObject(doc.data)) || !isVersion(doc.version, 0))
          errors.push({ field: `documents.${key}`, message: 'must be { data: object | null, version }' });
      }
    }
  }
  if (body.settings === undefined && body.content === undefined && body.documents === undefined)
    errors.push({ field: 'body', message: 'nothing to save' });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

/** POST /admin/themes/:id/revisions/:revisionId/restore */
export function validateThemeRestore(req, res, next) {
  if (!isVersion(req.body?.themeVersion, 1))
    return next(new ValidationError('Validation failed', [{ field: 'themeVersion', message: 'themeVersion is required' }]));
  next();
}

/** PUT /admin/themes/rollout (SYSTEM_ADMIN) */
export function validateThemeRollout(req, res, next) {
  if (typeof req.body?.enabled !== 'boolean')
    return next(new ValidationError('Validation failed', [{ field: 'enabled', message: 'enabled must be true or false' }]));
  next();
}
