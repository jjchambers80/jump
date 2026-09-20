// Shared URL-slug contract for every public resource. Persistence services use
// resolveSlug to retain custom values and uniqueSlug to allocate a free value
// in the route's database scope.

import { ConflictError, ValidationError } from '../middleware/errorHandler.js';

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 60;

export function slugify(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * Resolve the stored slug and its provenance.
 *
 * `customSlug === undefined` means the caller did not edit the slug. Existing
 * custom values remain stable, while generated values follow title changes.
 * null, an empty string, or whitespace explicitly resets a custom slug to the
 * generated title value.
 */
export function resolveSlug({
  title,
  customSlug,
  currentSlug = null,
  slugCustomized = false,
}) {
  if (customSlug === undefined && currentSlug && slugCustomized) {
    return { slug: currentSlug, slugCustomized: true };
  }

  const hasCustomSlug =
    customSlug !== undefined && customSlug !== null && String(customSlug).trim().length > 0;
  const slug = slugify(hasCustomSlug ? customSlug : title);
  if (!slug) throw new ValidationError('URL slug must contain letters or numbers');

  return { slug, slugCustomized: hasCustomSlug };
}

function suffixedSlug(base, suffix) {
  const ending = `-${suffix}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - ending.length).replace(/-+$/g, '')}${ending}`;
}

/** Allocate the first free slug in a model and route scope. */
export async function uniqueSlug(
  model,
  { scope = {}, raw, exceptId = null, field = 'slug', fallback = null, maxAttempts = 100 }
) {
  const base = slugify(raw) || slugify(fallback);
  if (!base) throw new ValidationError('URL slug must contain letters or numbers');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const slug = attempt === 1 ? base : suffixedSlug(base, attempt);
    const where = { ...scope, [field]: slug };
    if (exceptId) where.NOT = { id: exceptId };
    const clash = await model.findFirst({ where, select: { id: true } });
    if (!clash) return slug;
  }

  throw new ConflictError('Could not find a free URL slug');
}
