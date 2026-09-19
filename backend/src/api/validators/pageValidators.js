import { ValidationError } from '../../middleware/errorHandler.js';

export function validateCreatePage(req, res, next) {
  const errors = [];
  const { title, content, isVisible } = req.body;

  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.push({ field: 'title', message: 'title is required' });
  } else if (title.trim().length > 255) {
    errors.push({ field: 'title', message: 'title must be 255 characters or less' });
  }

  if (typeof content !== 'string' || content.trim().length === 0) {
    errors.push({ field: 'content', message: 'content is required' });
  }

  if (isVisible !== undefined && typeof isVisible !== 'boolean') {
    errors.push({ field: 'isVisible', message: 'isVisible must be a boolean' });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
}
