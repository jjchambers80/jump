// URL handles derived from a title, unique within a scope: "About us" →
// about-us, then about-us-2, about-us-3 on clash. Shared by pages, blogs,
// blog posts and menus.

import { slugify } from './slug.js';
import { ConflictError, ValidationError } from '../middleware/errorHandler.js';

/**
 * @param {{ findFirst: Function }} model  Prisma delegate
 * @param {object} scope                    where-clause fields that define uniqueness (e.g. { organizationId })
 * @param {string} raw                      title or typed handle
 * @param {string|null} exceptId            the record being updated
 */
export async function uniqueHandle(model, scope, raw, exceptId = null) {
  const base = slugify(raw);
  if (!base) throw new ValidationError('URL handle must contain letters or numbers');
  let handle = base;
  for (let i = 2; i < 100; i += 1) {
    const clash = await model.findFirst({
      where: { ...scope, handle, NOT: exceptId ? { id: exceptId } : undefined },
      select: { id: true },
    });
    if (!clash) return handle;
    handle = `${base}-${i}`;
  }
  throw new ConflictError('Could not find a free URL handle');
}
