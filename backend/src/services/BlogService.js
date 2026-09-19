// Content › Blog posts (spec 026): blogs are the Shopify-style containers
// (the organizer's "category"). Every organization gets "News" lazily.

import { prisma } from '@jump/db';
import { uniqueHandle } from '../utils/uniqueHandle.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

export const DEFAULT_BLOG = { title: 'News', handle: 'news' };

class BlogService {
  /** Create the default blog when the organization has none. Idempotent. */
  async ensureDefault(organizationId) {
    const existing = await prisma.blog.findFirst({
      where: { organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (existing) return existing;
    try {
      return await prisma.blog.create({ data: { organizationId, ...DEFAULT_BLOG } });
    } catch (error) {
      if (error.code === 'P2002') {
        return prisma.blog.findFirst({ where: { organizationId, handle: DEFAULT_BLOG.handle } });
      }
      throw error;
    }
  }

  async list(organizationId) {
    await this.ensureDefault(organizationId);
    const blogs = await prisma.blog.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { posts: true } } },
    });
    return blogs.map((blog) => this.serialize(blog));
  }

  async get(organizationId, id) {
    const blog = await prisma.blog.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { posts: true } } },
    });
    if (!blog) throw new NotFoundError('Blog not found');
    return this.serialize(blog);
  }

  async getByHandle(organizationId, handle) {
    return prisma.blog.findFirst({ where: { organizationId, handle } });
  }

  async create(organizationId, data) {
    const title = data.title.trim();
    const blog = await prisma.blog.create({
      data: {
        organizationId,
        title,
        handle: await uniqueHandle(prisma.blog, { organizationId }, data.handle || title),
      },
      include: { _count: { select: { posts: true } } },
    });
    return this.serialize(blog);
  }

  async update(organizationId, id, data) {
    const existing = await prisma.blog.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Blog not found');
    const patch = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.handle !== undefined) {
      patch.handle = await uniqueHandle(
        prisma.blog,
        { organizationId },
        data.handle || patch.title || existing.title,
        id
      );
    }
    const blog = await prisma.blog.update({
      where: { id },
      data: patch,
      include: { _count: { select: { posts: true } } },
    });
    return this.serialize(blog);
  }

  /** Refused while posts remain unless they are moved to another blog first. */
  async remove(organizationId, id, { moveToBlogId = null } = {}) {
    const existing = await prisma.blog.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { posts: true } } },
    });
    if (!existing) throw new NotFoundError('Blog not found');
    const total = await prisma.blog.count({ where: { organizationId } });
    if (total <= 1) throw new ValidationError('Keep at least one blog');

    if (existing._count.posts > 0) {
      if (!moveToBlogId) {
        throw new ConflictError('This blog still has posts', { posts: existing._count.posts });
      }
      if (moveToBlogId === id)
        throw new ValidationError('Choose a different blog to move posts to');
      const target = await prisma.blog.findFirst({ where: { id: moveToBlogId, organizationId } });
      if (!target) throw new NotFoundError('Target blog not found');
      await prisma.$transaction(async (tx) => {
        const posts = await tx.blogPost.findMany({
          where: { blogId: id },
          select: { id: true, handle: true },
        });
        for (const post of posts) {
          const clash = await tx.blogPost.findFirst({
            where: { blogId: moveToBlogId, handle: post.handle },
            select: { id: true },
          });
          await tx.blogPost.update({
            where: { id: post.id },
            data: {
              blogId: moveToBlogId,
              ...(clash ? { handle: `${post.handle}-${post.id.slice(-6)}` } : {}),
            },
          });
        }
        await tx.blog.delete({ where: { id } });
      });
      return;
    }
    await prisma.blog.delete({ where: { id } });
  }

  serialize(blog) {
    return {
      id: blog.id,
      organizationId: blog.organizationId,
      title: blog.title,
      handle: blog.handle,
      postCount: blog._count ? blog._count.posts : undefined,
      createdAt: blog.createdAt,
      updatedAt: blog.updatedAt,
    };
  }
}

export default new BlogService();
