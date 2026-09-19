import { ValidationError } from '../../middleware/errorHandler.js';
import { SEO_TITLE_MAX, SEO_DESCRIPTION_MAX } from '../../utils/pageLimits.js';
import { SLUG_MAX_LENGTH } from '../../utils/slug.js';

/**
 * Shared field checks. `partial` (PUT) lets required fields be absent but
 * still rejects them when present and invalid.
 */
function collectErrors(body, { partial }) {
  const errors = [];
  const { title, content, isVisible, slug, seoTitle, seoDescription } = body;

  if (title !== undefined || !partial) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      errors.push({ field: 'title', message: 'title is required' });
    } else if (title.trim().length > 255) {
      errors.push({ field: 'title', message: 'title must be 255 characters or less' });
    }
  }

  if (content !== undefined || !partial) {
    if (typeof content !== 'string' || content.trim().length === 0) {
      errors.push({ field: 'content', message: 'content is required' });
    }
  }

  if (isVisible !== undefined && typeof isVisible !== 'boolean') {
    errors.push({ field: 'isVisible', message: 'isVisible must be a boolean' });
  }

  if (slug !== undefined && slug !== null) {
    if (typeof slug !== 'string') {
      errors.push({ field: 'slug', message: 'slug must be a string' });
    } else if (slug.trim().length > SLUG_MAX_LENGTH) {
      errors.push({ field: 'slug', message: `slug must be ${SLUG_MAX_LENGTH} characters or less` });
    }
  }

  if (seoTitle !== undefined && seoTitle !== null) {
    if (typeof seoTitle !== 'string') {
      errors.push({ field: 'seoTitle', message: 'seoTitle must be a string' });
    } else if (seoTitle.trim().length > SEO_TITLE_MAX) {
      errors.push({
        field: 'seoTitle',
        message: `seoTitle must be ${SEO_TITLE_MAX} characters or less`,
      });
    }
  }

  if (seoDescription !== undefined && seoDescription !== null) {
    if (typeof seoDescription !== 'string') {
      errors.push({ field: 'seoDescription', message: 'seoDescription must be a string' });
    } else if (seoDescription.trim().length > SEO_DESCRIPTION_MAX) {
      errors.push({
        field: 'seoDescription',
        message: `seoDescription must be ${SEO_DESCRIPTION_MAX} characters or less`,
      });
    }
  }

  return errors;
}

export function validateCreatePage(req, res, next) {
  const errors = collectErrors(req.body, { partial: false });
  if (errors.length > 0) return next(new ValidationError('Validation failed', errors));
  next();
}

export function validateUpdatePage(req, res, next) {
  const errors = collectErrors(req.body, { partial: true });
  if (errors.length > 0) return next(new ValidationError('Validation failed', errors));
  next();
}
