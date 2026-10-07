// Content › Galleries (spec 046): reusable photo sets over Content › Files,
// split into ordered sections. Saved as one tree (PUT), like menus, so the
// storefront never sees a half-edited gallery. Pages, blog posts and themes
// reference a gallery by id with no foreign key: a deleted gallery renders
// nothing and placements are found by searching content (`_placementIndex`).

import { prisma } from '@jump/db';
import { uniqueHandle } from '../utils/uniqueHandle.js';
import { galleryIdsInThemeJson } from '@jump/theme';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import imageService from './ImageService.js';
import storeFileService from './StoreFileService.js';

export const GALLERY_MAX_SECTIONS = 20;
export const GALLERY_MAX_ITEMS = 500;

/** Gallery ids embedded in sanitised content HTML (the editor's Insert gallery). */
export function galleryIdsInHtml(html) {
  const ids = new Set();
  if (typeof html === 'string') for (const match of html.matchAll(/data-jump-gallery="([a-z0-9]+)"/g)) ids.add(match[1]);
  return [...ids];
}

const ITEM_INCLUDE = { file: { include: { file: true, image: true } } };
const TREE_INCLUDE = {
  sections: {
    orderBy: { position: 'asc' },
    include: { items: { orderBy: { position: 'asc' }, include: ITEM_INCLUDE } },
  },
};

function codedError(message, code, details) {
  const error = new ValidationError(message, details);
  error.code = code;
  return error;
}

/** Item alt text first, then the file's; '' when decorative. */
export function effectiveAlt(item) {
  if (item.decorative) return '';
  return item.altText?.trim() || item.file?.altText?.trim() || '';
}

class GalleryService {
  async list(organizationId) {
    const [galleries, placements] = await Promise.all([
      prisma.gallery.findMany({
        where: { organizationId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        include: {
          sections: {
            orderBy: { position: 'asc' },
            select: {
              _count: { select: { items: true } },
              items: { orderBy: { position: 'asc' }, take: 4, include: ITEM_INCLUDE },
            },
          },
        },
      }),
      this._placementIndex(organizationId),
    ]);
    return galleries.map((gallery) => {
      // The first four photos, in gallery order: the cover and the editor's embed tile.
      const thumbUrls = gallery.sections.flatMap((section) => section.items).slice(0, 4).map((item) => this._thumbUrl(item));
      return {
        id: gallery.id,
        title: gallery.title,
        handle: gallery.handle,
        sectionCount: gallery.sections.length,
        photoCount: gallery.sections.reduce((sum, section) => sum + section._count.items, 0),
        coverThumbUrl: thumbUrls[0] ?? null,
        thumbUrls,
        placementCount: placements.get(gallery.id)?.length || 0,
        updatedAt: gallery.updatedAt,
      };
    });
  }

  async get(organizationId, id) {
    const gallery = await prisma.gallery.findFirst({
      where: { id, organizationId },
      include: TREE_INCLUDE,
    });
    if (!gallery) throw new NotFoundError('Gallery not found');
    const placements = (await this._placementIndex(organizationId)).get(id) || [];
    return this._serializeAdmin(gallery, placements);
  }

  async create(organizationId, { title }) {
    const clean = title.trim();
    const gallery = await prisma.gallery.create({
      data: {
        organizationId,
        title: clean,
        handle: await uniqueHandle(prisma.gallery, { organizationId }, clean),
        sections: { create: [{ position: 0 }] },
      },
    });
    return this.get(organizationId, gallery.id);
  }

  /** Replace the title, description and the whole section/item tree in one transaction. */
  async replace(organizationId, id, { title, description, sections }) {
    const existing = await prisma.gallery.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Gallery not found');

    const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
    if (sections.length > GALLERY_MAX_SECTIONS || itemCount > GALLERY_MAX_ITEMS) {
      throw codedError(
        `A gallery holds at most ${GALLERY_MAX_SECTIONS} sections and ${GALLERY_MAX_ITEMS} photos`,
        'GALLERY_LIMIT',
        { sections: sections.length, items: itemCount }
      );
    }

    const fileIds = [...new Set(sections.flatMap((section) => section.items.map((item) => item.fileId)))];
    const files = fileIds.length
      ? await prisma.storeFile.findMany({
          where: { id: { in: fileIds }, organizationId, imageId: { not: null } },
          select: { id: true, altText: true },
        })
      : [];
    const fileAlt = new Map(files.map((file) => [file.id, file.altText]));
    const unknown = fileIds.filter((fileId) => !fileAlt.has(fileId));
    if (unknown.length) {
      throw codedError('Galleries hold images from this store’s Files only', 'GALLERY_FILE_INVALID', {
        fileIds: unknown,
      });
    }
    const missingAlt = [];
    sections.forEach((section, sectionIndex) =>
      section.items.forEach((item, itemIndex) => {
        if (!item.decorative && !item.altText?.trim() && !fileAlt.get(item.fileId)?.trim()) {
          missingAlt.push({ section: sectionIndex, item: itemIndex, fileId: item.fileId });
        }
      })
    );
    if (missingAlt.length) {
      throw codedError('Every photo needs alt text or must be marked decorative', 'ALT_TEXT_REQUIRED', {
        items: missingAlt,
      });
    }

    await prisma.$transaction(async (tx) => {
      const data = { updatedAt: new Date() };
      if (title !== undefined) data.title = title.trim();
      if (description !== undefined) data.description = description?.trim() || null;
      // Scoped write: a gallery deleted since the check above is a 404, not a 500.
      const { count } = await tx.gallery.updateMany({ where: { id, organizationId }, data });
      if (!count) throw new NotFoundError('Gallery not found');
      await tx.gallerySection.deleteMany({ where: { galleryId: id } });
      for (const [position, section] of sections.entries()) {
        await tx.gallerySection.create({
          data: {
            galleryId: id,
            position,
            title: section.title?.trim() || null,
            items: {
              create: section.items.map((item, itemPosition) => ({
                fileId: item.fileId,
                position: itemPosition,
                altText: item.decorative ? null : item.altText?.trim() || null,
                decorative: Boolean(item.decorative),
                caption: item.caption?.trim() || null,
              })),
            },
          },
        });
      }
      await storeFileService.syncReferences('GALLERY', id, { items: fileIds }, organizationId, { tx });
    });
    return this.get(organizationId, id);
  }

  async remove(organizationId, id) {
    const existing = await prisma.gallery.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Gallery not found');
    await prisma.$transaction(async (tx) => {
      await storeFileService.clearReferences('GALLERY', id, { tx });
      await tx.gallery.delete({ where: { id } });
    });
  }

  async placements(organizationId, id) {
    return (await this._placementIndex(organizationId)).get(id) || [];
  }

  /**
   * Storefront: galleries by id for one organization, keyed by id, in the
   * public shape (046C/046D). Unknown, foreign or empty galleries are left out.
   */
  async resolveForOrg(organizationId, ids) {
    const wanted = [...new Set((ids || []).filter((id) => typeof id === 'string' && id))];
    if (!wanted.length) return {};
    const galleries = await prisma.gallery.findMany({
      where: { id: { in: wanted }, organizationId },
      include: TREE_INCLUDE,
    });
    const out = {};
    for (const gallery of galleries) {
      const serialized = this.serializePublic(gallery);
      if (serialized.sections.length) out[gallery.id] = serialized;
    }
    return out;
  }

  /** The galleries a page or blog post body embeds, for its public payload. */
  async resolveInHtml(organizationId, html) {
    return this.resolveForOrg(organizationId, galleryIdsInHtml(html));
  }

  serializePublic(gallery) {
    return {
      id: gallery.id,
      title: gallery.title,
      sections: gallery.sections
        .filter((section) => section.items.length)
        .map((section) => ({
          id: section.id,
          title: section.title,
          items: section.items.map((item) => ({
            id: item.id,
            ...this._sources(item),
            ...this._size(item),
            alt: effectiveAlt(item),
            caption: item.caption,
          })),
        })),
    };
  }

  _serializeAdmin(gallery, placements) {
    return {
      id: gallery.id,
      title: gallery.title,
      handle: gallery.handle,
      description: gallery.description,
      sections: gallery.sections.map((section) => ({
        id: section.id,
        title: section.title,
        items: section.items.map((item) => ({
          id: item.id,
          fileId: item.fileId,
          altText: item.altText,
          decorative: item.decorative,
          caption: item.caption,
          alt: effectiveAlt(item),
          file: {
            name: item.file.name,
            altText: item.file.altText,
            ...this._size(item),
            thumbUrl: this._thumbUrl(item),
            previewUrl: imageService.servingUrl(this._image(item), 'card'),
            ...this._sources(item),
          },
        })),
      })),
      placements,
      updatedAt: gallery.updatedAt,
    };
  }

  /** Displayed size: File holds it with EXIF rotation applied, StoreFile does not. */
  _size(item) {
    return {
      width: item.file.file.width ?? item.file.width,
      height: item.file.file.height ?? item.file.height,
    };
  }

  _image(item) {
    return { ...item.file.image, file: item.file.file };
  }

  _thumbUrl(item) {
    return imageService.servingUrl(this._image(item), 'thumb');
  }

  _sources(item) {
    return imageService.widthSources(this._image(item));
  }

  /**
   * galleryId → [{ kind, targetId, title, href }] for one organization: pages
   * and blog posts embedding `data-jump-gallery="<id>"` (046D), theme
   * documents holding the id (046C). One pass, matched in memory.
   */
  async _placementIndex(organizationId) {
    const marker = 'data-jump-gallery="';
    const [pages, posts, documents] = await Promise.all([
      prisma.page.findMany({
        where: { organizationId, content: { contains: marker } },
        select: { id: true, title: true, content: true },
      }),
      prisma.blogPost.findMany({
        where: { organizationId, content: { contains: marker } },
        select: { id: true, title: true, content: true },
      }),
      prisma.themeDocument.findMany({
        where: { theme: { organizationId } },
        select: { data: true, theme: { select: { id: true, name: true } } },
      }),
    ]);
    const index = new Map();
    const add = (galleryId, placement) => {
      if (!index.has(galleryId)) index.set(galleryId, []);
      const list = index.get(galleryId);
      if (!list.some((p) => p.kind === placement.kind && p.targetId === placement.targetId)) list.push(placement);
    };
    for (const page of pages) {
      for (const galleryId of galleryIdsInHtml(page.content)) {
        add(galleryId, {
          kind: 'PAGE',
          targetId: page.id,
          title: page.title,
          href: `/admin/online-store/pages/${page.id}`,
        });
      }
    }
    for (const post of posts) {
      for (const galleryId of galleryIdsInHtml(post.content)) {
        add(galleryId, {
          kind: 'BLOG_POST',
          targetId: post.id,
          title: post.title,
          href: `/admin/content/blog-posts/${post.id}`,
        });
      }
    }
    // Only the Gallery section's own setting counts, never an id that merely appears in a document.
    for (const document of documents) {
      for (const galleryId of galleryIdsInThemeJson(document.data)) {
        add(galleryId, {
          kind: 'THEME',
          targetId: document.theme.id,
          title: `Theme ${document.theme.name}`,
          href: `/admin/online-store/themes/${document.theme.id}/editor`,
        });
      }
    }
    return index;
  }
}

export default new GalleryService();
