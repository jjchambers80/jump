import { ValidationError } from '../../middleware/errorHandler.js';

const isText = (value, max, { optional = true } = {}) =>
  (optional && (value === undefined || value === null)) ||
  (typeof value === 'string' && value.trim().length <= max);

const titleOk = (title) =>
  typeof title === 'string' && title.trim().length > 0 && title.trim().length <= 100;

export function validateCreateGallery(req, res, next) {
  if (!titleOk(req.body?.title)) {
    return next(
      new ValidationError('Validation failed', [{ field: 'title', message: 'title must be 1–100 characters' }])
    );
  }
  next();
}

/** PUT /admin/galleries/:galleryId — shape only; GalleryService checks limits, files and alt text. */
export function validateReplaceGallery(req, res, next) {
  const body = req.body || {};
  const errors = [];
  if (body.title !== undefined && !titleOk(body.title)) {
    errors.push({ field: 'title', message: 'title must be 1–100 characters' });
  }
  if (!isText(body.description, 500)) {
    errors.push({ field: 'description', message: 'description must be at most 500 characters' });
  }
  if (!Array.isArray(body.sections)) {
    errors.push({ field: 'sections', message: 'sections must be a list' });
  } else {
    body.sections.forEach((section, s) => {
      if (!section || typeof section !== 'object' || !Array.isArray(section.items)) {
        errors.push({ field: `sections[${s}]`, message: 'a section needs an items list' });
        return;
      }
      if (!isText(section.title, 120)) {
        errors.push({ field: `sections[${s}].title`, message: 'title must be at most 120 characters' });
      }
      section.items.forEach((item, i) => {
        const at = `sections[${s}].items[${i}]`;
        if (!item || typeof item.fileId !== 'string' || !item.fileId) {
          errors.push({ field: `${at}.fileId`, message: 'fileId is required' });
          return;
        }
        if (!isText(item.altText, 500)) errors.push({ field: `${at}.altText`, message: 'alt text must be at most 500 characters' });
        if (!isText(item.caption, 300)) errors.push({ field: `${at}.caption`, message: 'caption must be at most 300 characters' });
        if (item.decorative !== undefined && typeof item.decorative !== 'boolean') {
          errors.push({ field: `${at}.decorative`, message: 'decorative must be true or false' });
        }
      });
    });
  }
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}
