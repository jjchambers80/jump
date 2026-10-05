import { ValidationError } from '../../middleware/errorHandler.js';
import { SEO_TITLE_MAX, SEO_DESCRIPTION_MAX } from '../../utils/pageLimits.js';
import { normalizeCustomSlug } from '../../utils/slug.js';
import { TEMPLATE_NAME_RE } from '../../utils/pageTemplateManifest.js';

/**
 * Shared field checks. `partial` (PUT) lets required fields be absent but
 * still rejects them when present and invalid.
 */
function collectErrors(body, { partial }) {
  const errors = [];
  const { title, content, isVisible, slug, seoTitle, seoDescription, template, applicationFormId, applyLabel } = body;

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

  // Spec 042: a page template name, or null for the default layout. Whether
  // the organization has it is checked in PageService.
  if (template !== undefined && template !== null) {
    if (typeof template !== 'string' || !TEMPLATE_NAME_RE.test(template)) {
      errors.push({ field: 'template', message: 'template must be a page template name or null' });
    }
  }

  // Spec 044D: the Apply button. PageService checks the form is a standing form of this organization.
  if (applicationFormId !== undefined && applicationFormId !== null && typeof applicationFormId !== 'string') {
    errors.push({ field: 'applicationFormId', message: 'applicationFormId must be a string' });
  }
  if (applyLabel !== undefined && applyLabel !== null) {
    if (typeof applyLabel !== 'string') errors.push({ field: 'applyLabel', message: 'applyLabel must be a string' });
    else if (applyLabel.trim().length > 40) errors.push({ field: 'applyLabel', message: 'Button label must be 40 characters or less' });
  }

  if (slug !== undefined && slug !== null) {
    try {
      body.slug = normalizeCustomSlug(slug);
    } catch (error) {
      errors.push({ field: 'slug', message: error.message });
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
