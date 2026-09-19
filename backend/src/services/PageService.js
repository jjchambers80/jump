import { prisma } from '@jump/db';
import { slugify } from '../utils/slug.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

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

  async create(organizationId, data) {
    const title = data.title.trim();
    return prisma.page.create({
      data: {
        organizationId,
        title,
        slug: await this._uniqueSlug(organizationId, data.slug || title),
        content: data.content.trim(),
        isVisible: data.isVisible ?? true,
        seoTitle: optionalText(data.seoTitle) ?? null,
        seoDescription: optionalText(data.seoDescription) ?? null,
      },
    });
  }

  /** Partial update: only fields present in `data` change. */
  async update(organizationId, pageId, data) {
    const existing = await this.get(organizationId, pageId);
    const patch = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.content !== undefined) patch.content = data.content.trim();
    if (data.isVisible !== undefined) patch.isVisible = data.isVisible;
    if (data.seoTitle !== undefined) patch.seoTitle = optionalText(data.seoTitle);
    if (data.seoDescription !== undefined) patch.seoDescription = optionalText(data.seoDescription);
    if (data.slug !== undefined) {
      // Empty handle means "derive it from the title again".
      patch.slug = await this._uniqueSlug(
        organizationId,
        data.slug || patch.title || existing.title,
        pageId
      );
    }
    return prisma.page.update({ where: { id: existing.id }, data: patch });
  }

  async _uniqueSlug(organizationId, raw, exceptPageId = null) {
    const base = slugify(raw);
    if (!base) throw new ValidationError('URL handle must contain letters or numbers');
    let slug = base;
    for (let i = 2; i < 100; i += 1) {
      const clash = await prisma.page.findFirst({
        where: { organizationId, slug, NOT: exceptPageId ? { id: exceptPageId } : undefined },
        select: { id: true },
      });
      if (!clash) return slug;
      slug = `${base}-${i}`;
    }
    throw new ConflictError('Could not find a free URL handle');
  }
}

export default new PageService();
