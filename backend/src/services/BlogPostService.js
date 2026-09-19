// Content › Blog posts (spec 026). HTML is sanitised on write (the trust
// boundary); the storefront renders `content` as stored. Public when
// isVisible and publishedAt is null or past. See docs/wiki/features/blog-posts.md.

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { excerptFromHtml, htmlToText, sanitizeContentHtml } from '../utils/sanitizeHtml.js';
import { uniqueHandle } from '../utils/uniqueHandle.js';
import blogService from './BlogService.js';
import storeFileService from './StoreFileService.js';

const PAGE_SIZE = 25;
const PUBLIC_PAGE_SIZE = 12;
export const BLOG_POST_TAG_MAX = 40;
export const BLOG_POST_TAGS_MAX = 20;
export const BLOG_POST_CONTENT_MAX = 200_000;

const SORTS = {
  updated_desc: [{ updatedAt: 'desc' }, { id: 'desc' }],
  updated_asc: [{ updatedAt: 'asc' }, { id: 'asc' }],
  title: [{ title: 'asc' }, { id: 'asc' }],
  published_desc: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
};

function optionalText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

/** Visible / Hidden / Scheduled, computed once here so list and pill agree. */
export function postStatus(post, now = new Date()) {
  if (!post.isVisible) return 'hidden';
  if (post.publishedAt && post.publishedAt > now) return 'scheduled';
  return 'visible';
}

export function normalizeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of tags || []) {
    const tag = String(raw).trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

class BlogPostService {
  get include() {
    return {
      blog: { select: { id: true, title: true, handle: true } },
      featuredFile: { include: { file: true, image: true } },
    };
  }

  _statusWhere(status, now) {
    if (status === 'visible')
      return { isVisible: true, OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] };
    if (status === 'hidden') return { isVisible: false };
    if (status === 'scheduled') return { isVisible: true, publishedAt: { gt: now } };
    return {};
  }

  async list(organizationId, query = {}) {
    const now = new Date();
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || PAGE_SIZE));
    const base = { organizationId };
    if (query.blogId) base.blogId = String(query.blogId);
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    if (q) {
      base.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { authorName: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }
    const where = { ...base, ...this._statusWhere(query.status, now) };
    // Prisma merges a top-level OR from base and from status; nest to keep both.
    if (base.OR && where.OR && where.OR !== base.OR) {
      where.AND = [{ OR: base.OR }, { OR: where.OR }];
      delete where.OR;
    }
    const orderBy = SORTS[query.sort] || SORTS.updated_desc;
    const [rows, total, all, hidden, scheduled] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.include,
      }),
      prisma.blogPost.count({ where }),
      prisma.blogPost.count({ where: base }),
      prisma.blogPost.count({ where: { ...base, isVisible: false } }),
      prisma.blogPost.count({ where: { ...base, isVisible: true, publishedAt: { gt: now } } }),
    ]);
    return {
      posts: rows.map((row) => this.serialize(row, now)),
      total,
      page,
      pageSize,
      summary: { all, visible: all - hidden - scheduled, hidden, scheduled },
    };
  }

  async get(organizationId, id) {
    const row = await prisma.blogPost.findFirst({
      where: { id, organizationId },
      include: this.include,
    });
    if (!row) throw new NotFoundError('Blog post not found');
    return { ...this.serialize(row), neighbors: await this._neighbors(organizationId, row) };
  }

  async create(organizationId, data, user = null) {
    const title = data.title.trim();
    const blogId = data.blogId || (await blogService.ensureDefault(organizationId)).id;
    await this._assertBlog(organizationId, blogId);
    const authorName = (data.authorName ?? user?.name ?? '').trim() || 'Staff';
    const content = this._content(data.content ?? '');
    const featuredFileId = await this._featured(organizationId, data.featuredFileId);
    const isVisible = data.isVisible ?? false;
    const publishedAt = this._publishedAt(data.publishedAt, isVisible, null);
    const row = await prisma.blogPost.create({
      data: {
        organizationId,
        blogId,
        title,
        handle: await uniqueHandle(prisma.blogPost, { blogId }, data.handle || title),
        content,
        excerpt: data.excerpt === undefined ? null : this._excerpt(data.excerpt),
        authorName,
        tags: normalizeTags(data.tags),
        featuredFileId,
        isVisible,
        publishedAt,
        seoTitle: optionalText(data.seoTitle) ?? null,
        seoDescription: optionalText(data.seoDescription) ?? null,
      },
      include: this.include,
    });
    await this._syncReferences(organizationId, row);
    return { ...this.serialize(row), neighbors: await this._neighbors(organizationId, row) };
  }

  async update(organizationId, id, data) {
    const existing = await prisma.blogPost.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Blog post not found');
    const patch = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.blogId !== undefined && data.blogId !== existing.blogId) {
      await this._assertBlog(organizationId, data.blogId);
      patch.blogId = data.blogId;
    }
    if (data.content !== undefined) patch.content = this._content(data.content);
    if (data.excerpt !== undefined) patch.excerpt = this._excerpt(data.excerpt);
    if (data.authorName !== undefined)
      patch.authorName = data.authorName.trim() || existing.authorName;
    if (data.tags !== undefined) patch.tags = normalizeTags(data.tags);
    if (data.featuredFileId !== undefined)
      patch.featuredFileId = await this._featured(organizationId, data.featuredFileId);
    if (data.seoTitle !== undefined) patch.seoTitle = optionalText(data.seoTitle);
    if (data.seoDescription !== undefined) patch.seoDescription = optionalText(data.seoDescription);
    if (data.isVisible !== undefined) patch.isVisible = data.isVisible;
    if (data.publishedAt !== undefined || data.isVisible !== undefined) {
      patch.publishedAt = this._publishedAt(
        data.publishedAt !== undefined ? data.publishedAt : existing.publishedAt,
        patch.isVisible ?? existing.isVisible,
        existing.publishedAt
      );
    }
    const blogId = patch.blogId || existing.blogId;
    if (data.handle !== undefined || patch.blogId) {
      // "" means "derive from the (new) title again"; a blog move re-checks uniqueness.
      const raw = data.handle
        ? data.handle
        : data.handle === ''
          ? patch.title || existing.title
          : existing.handle;
      patch.handle = await uniqueHandle(prisma.blogPost, { blogId }, raw, id);
    }
    const row = await prisma.blogPost.update({ where: { id }, data: patch, include: this.include });
    if (
      patch.content !== undefined ||
      patch.excerpt !== undefined ||
      patch.featuredFileId !== undefined
    ) {
      await this._syncReferences(organizationId, row);
    }
    return { ...this.serialize(row), neighbors: await this._neighbors(organizationId, row) };
  }

  async remove(organizationId, id) {
    const existing = await prisma.blogPost.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Blog post not found');
    await prisma.blogPost.delete({ where: { id } });
    await storeFileService.clearReferences('BLOG_POST', id);
  }

  async bulk(organizationId, ids, action) {
    const rows = await prisma.blogPost.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, isVisible: true, publishedAt: true },
    });
    const found = rows.map((row) => row.id);
    const missing = ids.filter((id) => !found.includes(id));
    if (action === 'delete') {
      await prisma.blogPost.deleteMany({ where: { id: { in: found } } });
      await prisma.storeFileReference.deleteMany({
        where: { kind: 'BLOG_POST', targetId: { in: found } },
      });
    } else if (action === 'show') {
      const now = new Date();
      await prisma.$transaction(
        rows.map((row) =>
          prisma.blogPost.update({
            where: { id: row.id },
            data: { isVisible: true, publishedAt: row.publishedAt ?? now },
          })
        )
      );
    } else if (action === 'hide') {
      await prisma.blogPost.updateMany({
        where: { id: { in: found } },
        data: { isVisible: false },
      });
    } else {
      throw new ValidationError('Unknown bulk action');
    }
    return {
      affected: found,
      failed: missing.map((id) => ({ id, message: 'Blog post not found' })),
    };
  }

  async tags(organizationId) {
    const rows = await prisma.blogPost.findMany({
      where: { organizationId },
      select: { tags: true },
    });
    const counts = new Map();
    for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }

  // ── Storefront ────────────────────────────────────────────────────────────

  async publicList(organizationId, blogHandle, page = 1) {
    const blog = await blogService.getByHandle(organizationId, blogHandle);
    if (!blog) throw new NotFoundError('Blog not found');
    const now = new Date();
    const where = { blogId: blog.id, ...this._statusWhere('visible', now) };
    const current = Math.max(1, Number(page) || 1);
    const [rows, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * PUBLIC_PAGE_SIZE,
        take: PUBLIC_PAGE_SIZE,
        include: this.include,
      }),
      prisma.blogPost.count({ where }),
    ]);
    return {
      blog: { id: blog.id, title: blog.title, handle: blog.handle },
      posts: rows.map((row) => this.serializePublic(row, { summary: true })),
      total,
      page: current,
      pageSize: PUBLIC_PAGE_SIZE,
    };
  }

  async publicGet(organizationId, blogHandle, postHandle) {
    const blog = await blogService.getByHandle(organizationId, blogHandle);
    if (!blog) throw new NotFoundError('Blog post not found');
    const row = await prisma.blogPost.findFirst({
      where: { blogId: blog.id, handle: postHandle, ...this._statusWhere('visible', new Date()) },
      include: this.include,
    });
    if (!row) throw new NotFoundError('Blog post not found');
    return this.serializePublic(row);
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  serialize(row, now = new Date()) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      blogId: row.blogId,
      blog: row.blog,
      title: row.title,
      handle: row.handle,
      content: row.content,
      excerpt: row.excerpt,
      authorName: row.authorName,
      tags: row.tags,
      featuredFileId: row.featuredFileId,
      featuredFile: row.featuredFile ? storeFileService.serialize(row.featuredFile) : null,
      isVisible: row.isVisible,
      publishedAt: row.publishedAt,
      status: postStatus(row, now),
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  serializePublic(row, { summary = false } = {}) {
    const featured = row.featuredFile ? storeFileService.serialize(row.featuredFile) : null;
    const excerptHtml = row.excerpt || `<p>${excerptFromHtml(row.content)}</p>`;
    return {
      id: row.id,
      title: row.title,
      handle: row.handle,
      blog: row.blog,
      authorName: row.authorName,
      tags: row.tags,
      publishedAt: row.publishedAt,
      excerpt: excerptHtml,
      ...(summary ? {} : { content: row.content }),
      featuredImage: featured
        ? {
            url: featured.url,
            previewUrl: featured.previewUrl,
            alt: featured.altText || row.title,
            focalX: featured.focalX,
            focalY: featured.focalY,
            width: featured.width,
            height: featured.height,
          }
        : null,
      seoTitle: row.seoTitle || row.title,
      seoDescription: row.seoDescription || htmlToText(excerptHtml).slice(0, 160),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _content(html) {
    if (String(html).length > BLOG_POST_CONTENT_MAX)
      throw new ValidationError('Content is too long');
    return sanitizeContentHtml(html);
  }

  _excerpt(html) {
    if (html === null) return null;
    const clean = sanitizeContentHtml(html);
    return htmlToText(clean).length ? clean : null;
  }

  /**
   * FR-002: the first switch to visible stamps publishedAt = now when unset;
   * an explicit value (past or future) is kept; hidden posts keep their date.
   */
  _publishedAt(value, isVisible, previous) {
    let date = previous ?? null;
    if (value !== undefined) {
      if (value === null || value === '') date = null;
      else {
        date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new ValidationError('publishedAt must be a date');
      }
    }
    if (isVisible && !date) date = new Date();
    return date;
  }

  async _assertBlog(organizationId, blogId) {
    const blog = await prisma.blog.findFirst({
      where: { id: blogId, organizationId },
      select: { id: true },
    });
    if (!blog) throw new ValidationError('Blog not found');
  }

  async _featured(organizationId, fileId) {
    if (!fileId) return null;
    const file = await prisma.storeFile.findFirst({
      where: { id: fileId, organizationId, image: { isNot: null } },
      select: { id: true },
    });
    if (!file) throw new ValidationError('Featured image must be one of your image files');
    return file.id;
  }

  async _syncReferences(organizationId, row) {
    await storeFileService.syncReferences(
      'BLOG_POST',
      row.id,
      { content: row.content, excerpt: row.excerpt, featuredImage: row.featuredFileId },
      organizationId
    );
  }

  /** Previous / next in the list's default order (updated ↓), org-wide. */
  async _neighbors(organizationId, row) {
    const [prev, next] = await Promise.all([
      prisma.blogPost.findFirst({
        where: {
          organizationId,
          OR: [
            { updatedAt: { gt: row.updatedAt } },
            { updatedAt: row.updatedAt, id: { gt: row.id } },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, title: true },
      }),
      prisma.blogPost.findFirst({
        where: {
          organizationId,
          OR: [
            { updatedAt: { lt: row.updatedAt } },
            { updatedAt: row.updatedAt, id: { lt: row.id } },
          ],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true },
      }),
    ]);
    return { prev, next };
  }
}

export default new BlogPostService();
