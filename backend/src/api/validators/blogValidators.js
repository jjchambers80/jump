import { ValidationError } from '../../middleware/errorHandler.js';
import { SEO_TITLE_MAX, SEO_DESCRIPTION_MAX } from '../../utils/pageLimits.js';
import { SLUG_MAX_LENGTH, normalizeCustomSlug } from '../../utils/slug.js';
import {
  BLOG_POST_CONTENT_MAX,
  BLOG_POST_TAGS_MAX,
  BLOG_POST_TAG_MAX,
} from '../../services/BlogPostService.js';

const POST_KEYS = new Set([
  'title',
  'blogId',
  'content',
  'excerpt',
  'authorName',
  'tags',
  'featuredFileId',
  'isVisible',
  'publishedAt',
  'handle',
  'slug',
  'seoTitle',
  'seoDescription',
]);

function optionalString(errors, body, field, max) {
  if (body[field] === undefined || body[field] === null) return;
  if (typeof body[field] !== 'string') errors.push({ field, message: `${field} must be a string` });
  else if (body[field].trim().length > max)
    errors.push({ field, message: `${field} must be ${max} characters or less` });
}

function collectPostErrors(body, { partial }) {
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!POST_KEYS.has(key))
      errors.push({ field: key, message: `${key} is not an editable field` });
  }
  const {
    title,
    blogId,
    content,
    excerpt,
    tags,
    featuredFileId,
    isVisible,
    publishedAt,
    handle,
    slug,
  } = body;

  if (title !== undefined || !partial) {
    if (typeof title !== 'string' || title.trim().length === 0)
      errors.push({ field: 'title', message: 'title is required' });
    else if (title.trim().length > 255)
      errors.push({ field: 'title', message: 'title must be 255 characters or less' });
  }
  if (blogId !== undefined && (typeof blogId !== 'string' || !blogId))
    errors.push({ field: 'blogId', message: 'blogId must be a string' });
  if (content !== undefined) {
    if (typeof content !== 'string')
      errors.push({ field: 'content', message: 'content must be a string' });
    else if (content.length > BLOG_POST_CONTENT_MAX)
      errors.push({ field: 'content', message: 'content is too long' });
  }
  if (excerpt !== undefined && excerpt !== null && typeof excerpt !== 'string')
    errors.push({ field: 'excerpt', message: 'excerpt must be a string' });
  optionalString(errors, body, 'authorName', 100);
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))
      errors.push({ field: 'tags', message: 'tags must be a list of strings' });
    else if (tags.length > BLOG_POST_TAGS_MAX)
      errors.push({ field: 'tags', message: `Up to ${BLOG_POST_TAGS_MAX} tags` });
    else if (tags.some((tag) => tag.trim().length > BLOG_POST_TAG_MAX))
      errors.push({
        field: 'tags',
        message: `Each tag must be ${BLOG_POST_TAG_MAX} characters or less`,
      });
  }
  if (
    featuredFileId !== undefined &&
    featuredFileId !== null &&
    typeof featuredFileId !== 'string'
  ) {
    errors.push({ field: 'featuredFileId', message: 'featuredFileId must be a string' });
  }
  if (isVisible !== undefined && typeof isVisible !== 'boolean')
    errors.push({ field: 'isVisible', message: 'isVisible must be a boolean' });
  if (publishedAt !== undefined && publishedAt !== null && publishedAt !== '') {
    if (typeof publishedAt !== 'string' || Number.isNaN(new Date(publishedAt).getTime())) {
      errors.push({ field: 'publishedAt', message: 'publishedAt must be an ISO date' });
    }
  }
  if (handle !== undefined && handle !== null) {
    try {
      body.handle = normalizeCustomSlug(handle, 'handle');
    } catch (error) {
      errors.push({ field: 'handle', message: error.message });
    }
  }
  if (slug !== undefined && slug !== null) {
    try {
      body.slug = normalizeCustomSlug(slug);
    } catch (error) {
      errors.push({ field: 'slug', message: error.message });
    }
  }
  if (handle !== undefined && slug !== undefined && body.handle !== body.slug) {
    errors.push({ field: 'slug', message: 'slug and handle must match when both are provided' });
  }
  optionalString(errors, body, 'seoTitle', SEO_TITLE_MAX);
  optionalString(errors, body, 'seoDescription', SEO_DESCRIPTION_MAX);
  if (partial && Object.keys(body).length === 0)
    errors.push({ field: 'body', message: 'Nothing to update' });
  return errors;
}

export function validateCreateBlogPost(req, res, next) {
  const errors = collectPostErrors(req.body || {}, { partial: false });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

export function validateUpdateBlogPost(req, res, next) {
  const errors = collectPostErrors(req.body || {}, { partial: true });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

export function validateBulkPosts(req, res, next) {
  const { ids, action } = req.body || {};
  const errors = [];
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 200 ||
    ids.some((id) => typeof id !== 'string' || !id)
  ) {
    errors.push({ field: 'ids', message: 'ids must be 1–200 post ids' });
  }
  if (!['delete', 'show', 'hide'].includes(action))
    errors.push({ field: 'action', message: 'action must be delete, show or hide' });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

function collectBlogErrors(body, { partial }) {
  const errors = [];
  const { title, handle } = body;
  if (title !== undefined || !partial) {
    if (typeof title !== 'string' || title.trim().length === 0)
      errors.push({ field: 'title', message: 'title is required' });
    else if (title.trim().length > 100)
      errors.push({ field: 'title', message: 'title must be 100 characters or less' });
  }
  if (handle !== undefined && handle !== null) {
    if (typeof handle !== 'string')
      errors.push({ field: 'handle', message: 'handle must be a string' });
    else if (handle.trim().length > SLUG_MAX_LENGTH)
      errors.push({
        field: 'handle',
        message: `handle must be ${SLUG_MAX_LENGTH} characters or less`,
      });
  }
  return errors;
}

export function validateCreateBlog(req, res, next) {
  const errors = collectBlogErrors(req.body || {}, { partial: false });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}

export function validateUpdateBlog(req, res, next) {
  const errors = collectBlogErrors(req.body || {}, { partial: true });
  if (errors.length) return next(new ValidationError('Validation failed', errors));
  next();
}
