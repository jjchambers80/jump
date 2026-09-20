// URL handles derived from a title, unique within a scope: "About us" →
// about-us, then about-us-2, about-us-3 on clash. Shared by pages, blogs,
// blog posts and menus.

import { uniqueSlug } from './slug.js';

/**
 * @param {{ findFirst: Function }} model  Prisma delegate
 * @param {object} scope                    where-clause fields that define uniqueness (e.g. { organizationId })
 * @param {string} raw                      title or typed handle
 * @param {string|null} exceptId            the record being updated
 */
export async function uniqueHandle(model, scope, raw, exceptId = null) {
  return uniqueSlug(model, { scope, raw, exceptId, field: 'handle' });
}
