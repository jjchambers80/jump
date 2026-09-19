// Content › URL redirects (spec 028). See docs/wiki/features/url-redirects.md.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import {
  REDIRECTS_PER_ORG_MAX,
  REDIRECT_PATH_MAX,
  isAbsoluteTarget,
  isReservedPath,
  normalizeFromPath,
  normalizeToPath,
} from '../utils/redirectPath.js';

const PAGE_SIZE = 50;

class UrlRedirectService {
  async list(organizationId, { q, page } = {}) {
    const current = Math.max(1, Number(page) || 1);
    const term = typeof q === 'string' ? q.trim() : '';
    const where = {
      organizationId,
      ...(term
        ? {
            OR: [
              { fromPath: { contains: term, mode: 'insensitive' } },
              { toPath: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.urlRedirect.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.urlRedirect.count({ where }),
    ]);
    return {
      redirects: rows.map((row) => this.serialize(row)),
      total,
      page: current,
      pageSize: PAGE_SIZE,
    };
  }

  async create(organizationId, data) {
    const { fromPath, toPath } = this._clean(data);
    const count = await prisma.urlRedirect.count({ where: { organizationId } });
    if (count >= REDIRECTS_PER_ORG_MAX)
      throw new ValidationError(`Up to ${REDIRECTS_PER_ORG_MAX} redirects per organization`);
    try {
      return this.serialize(
        await prisma.urlRedirect.create({ data: { organizationId, fromPath, toPath } })
      );
    } catch (error) {
      if (error.code === 'P2002')
        throw new ConflictError('A redirect from that path already exists');
      throw error;
    }
  }

  async update(organizationId, id, data) {
    const existing = await prisma.urlRedirect.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundError('Redirect not found');
    const { fromPath, toPath } = this._clean({
      fromPath: data.fromPath ?? existing.fromPath,
      toPath: data.toPath ?? existing.toPath,
    });
    try {
      return this.serialize(
        await prisma.urlRedirect.update({ where: { id }, data: { fromPath, toPath } })
      );
    } catch (error) {
      if (error.code === 'P2002')
        throw new ConflictError('A redirect from that path already exists');
      throw error;
    }
  }

  async remove(organizationId, id) {
    const existing = await prisma.urlRedirect.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Redirect not found');
    await prisma.urlRedirect.delete({ where: { id } });
  }

  async removeMany(organizationId, ids) {
    const result = await prisma.urlRedirect.deleteMany({
      where: { id: { in: ids }, organizationId },
    });
    return { deleted: result.count };
  }

  /** Public lookup: `{ to, absolute }` or null. One hop, exact path match. */
  async resolve(organizationId, rawPath) {
    const fromPath = normalizeFromPath(rawPath);
    if (!fromPath) return null;
    const row = await prisma.urlRedirect.findUnique({
      where: { organizationId_fromPath: { organizationId, fromPath } },
    });
    return row ? { to: row.toPath, absolute: isAbsoluteTarget(row.toPath) } : null;
  }

  serialize(row) {
    return {
      id: row.id,
      fromPath: row.fromPath,
      toPath: row.toPath,
      absolute: isAbsoluteTarget(row.toPath),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  _clean(data) {
    const fromPath = normalizeFromPath(data.fromPath);
    if (!fromPath)
      throw new ValidationError('Validation failed', [
        { field: 'fromPath', message: 'Enter the path to redirect from, like /old-page' },
      ]);
    if (fromPath.length > REDIRECT_PATH_MAX)
      throw new ValidationError('Validation failed', [
        { field: 'fromPath', message: `Path must be ${REDIRECT_PATH_MAX} characters or less` },
      ]);
    if (isReservedPath(fromPath))
      throw new ValidationError('Validation failed', [
        {
          field: 'fromPath',
          message: 'That path is used by the storefront and cannot be redirected',
        },
      ]);
    const toPath = normalizeToPath(data.toPath);
    if (!toPath)
      throw new ValidationError('Validation failed', [
        {
          field: 'toPath',
          message: 'Enter a storefront path like /pages/faq or a full https:// link',
        },
      ]);
    if (!isAbsoluteTarget(toPath) && normalizeFromPath(toPath) === fromPath) {
      throw new ValidationError('Validation failed', [
        { field: 'toPath', message: 'A redirect cannot point at itself' },
      ]);
    }
    return { fromPath, toPath };
  }
}

export default new UrlRedirectService();
