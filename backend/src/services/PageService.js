import { prisma } from '@jump/db';
import { rethrowSlugConflict, resolveUniqueSlug, uniqueSlug } from '../utils/slug.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import storeFileService from './StoreFileService.js';
import { sanitizeContentHtml } from '../utils/sanitizeHtml.js';

/** Optional text field: trims, and stores an empty string as null. */
function optionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

class PageService {
  async list(organizationId) {
    return prisma.page.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** One page, only when it belongs to the organization; 404 otherwise. */
  async get(organizationId, pageId) {
    const page = await prisma.page.findFirst({ where: { id: pageId, organizationId } });
    if (!page) throw new NotFoundError('Page not found');
    return page;
  }

  /** Storefront: a visible page by handle; hidden pages are 404. */
  async getPublic(organizationId, slug) {
    const page = await prisma.page.findFirst({
      where: { organizationId, slug, isVisible: true },
      select: {
        id: true,
        title: true,
        slug: true,
        content: true,
        seoTitle: true,
        seoDescription: true,
        updatedAt: true,
      },
    });
    if (!page) throw new NotFoundError('Page not found');
    return page;
  }

  async create(organizationId, data) {
    const title = data.title.trim();
    const slugState = await resolveUniqueSlug(prisma.page, {
      scope: { organizationId },
      title,
      customSlug: data.slug,
    });
    let page;
    try {
      page = await prisma.page.create({
        data: {
          organizationId,
          title,
          ...slugState,
          content: sanitizeContentHtml(data.content),
          isVisible: data.isVisible ?? true,
          seoTitle: optionalText(data.seoTitle) ?? null,
          seoDescription: optionalText(data.seoDescription) ?? null,
        },
      });
    } catch (error) {
      rethrowSlugConflict(error);
    }
    // Content › Files "Used in" (spec 025).
    await storeFileService.syncReferences(
      'PAGE',
      page.id,
      { content: page.content },
      organizationId
    );
    return page;
  }

  /** Partial update: only fields present in `data` change. */
  async update(organizationId, pageId, data) {
    const existing = await this.get(organizationId, pageId);
    const patch = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.content !== undefined) patch.content = sanitizeContentHtml(data.content);
    if (data.isVisible !== undefined) patch.isVisible = data.isVisible;
    if (data.seoTitle !== undefined) patch.seoTitle = optionalText(data.seoTitle);
    if (data.seoDescription !== undefined) patch.seoDescription = optionalText(data.seoDescription);
    if (data.title !== undefined || data.slug !== undefined) {
      Object.assign(
        patch,
        await resolveUniqueSlug(prisma.page, {
          scope: { organizationId },
          title: patch.title ?? existing.title,
          customSlug: data.slug,
          currentSlug: existing.slug,
          slugCustomized: existing.slugCustomized,
          exceptId: pageId,
        })
      );
    }
    let page;
    try {
      page = await prisma.page.update({ where: { id: existing.id }, data: patch });
    } catch (error) {
      rethrowSlugConflict(error);
    }
    if (patch.content !== undefined) {
      await storeFileService.syncReferences(
        'PAGE',
        page.id,
        { content: page.content },
        organizationId
      );
    }
    return page;
  }

  async _uniqueSlug(organizationId, raw, exceptPageId = null) {
    return uniqueSlug(prisma.page, {
      scope: { organizationId },
      raw,
      exceptId: exceptPageId,
    });
  }
}

export default new PageService();
