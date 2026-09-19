import { ValidationError } from '../../middleware/errorHandler.js';

export function validateCreateMenu(req, res, next) {
  const { title } = req.body || {};
  if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 100) {
    return next(
      new ValidationError('Validation failed', [
        { field: 'title', message: 'title must be 1–100 characters' },
      ])
    );
  }
  next();
}

/** PUT /admin/menus/:menuId — shape only; MenuService validates the tree. */
export function validateReplaceMenu(req, res, next) {
  const body = req.body || {};
  const errors = [];
  if (
    body.title !== undefined &&
    (typeof body.title !== 'string' ||
      body.title.trim().length === 0 ||
      body.title.trim().length > 100)
  ) {
    errors.push({ field: 'title', message: 'title must be 1–100 characters' });
  }
  if (!Array.isArray(body.items)) errors.push({ field: 'items', message: 'items must be a list' });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}
