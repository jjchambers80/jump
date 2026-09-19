// Content › Files (spec 025): organization-scoped assets with public,
// hash-protected URLs. Images reuse the ImageService pipeline (dedupe on
// hash, variants, focal point); documents are stored once per hash under
// documents/<hash>.<ext>. See docs/wiki/features/content-files.md.

import { createHash } from 'crypto';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { slugify } from '../utils/slug.js';
import { backendPublicUrl } from '../utils/publicUrl.js';
import { fetchPublicResource } from '../utils/safeFetch.js';
import {
  ALLOWED_MIME_TO_EXT,
  FILE_NAME_MAX,
  MAX_FILE_BYTES,
  isImageMime,
} from '../utils/fileLimits.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import imageService from './ImageService.js';
import { getStorageBackend } from './storage/index.js';

export const STORE_FILE_USAGE = 'store_file';
const PAGE_SIZE = 50;
const SORTS = {
  created_desc: [{ createdAt: 'desc' }, { id: 'desc' }],
  created_asc: [{ createdAt: 'asc' }, { id: 'asc' }],
  name: [{ name: 'asc' }, { id: 'asc' }],
  size_desc: [{ file: { sizeBytes: 'desc' } }, { id: 'desc' }],
};

// Matches /files/<id>/<hash>/ inside src/href attributes, relative or absolute.
const FILE_URL_RE = /\/files\/([a-z0-9]+)\/[a-f0-9]{64}\//gi;

function documentKey(hash, ext) {
  return `documents/${hash}.${ext}`;
}

/** Display name from an upload's original filename: strip the extension and path. */
export function displayName(originalName) {
  const base = path.basename(String(originalName || '').split(/[?#]/)[0]);
  const withoutExt = base.replace(/\.[a-z0-9]{1,5}$/i, '');
  let name;
  try {
    name = decodeURIComponent(withoutExt);
  } catch {
    name = withoutExt;
  }
  name = name.replace(/[\\/]/g, '-').trim().slice(0, FILE_NAME_MAX).trim();
  return name || 'file';
}

/** File ids referenced by stored HTML (blog post / page content). */
export function fileIdsInHtml(html) {
  const ids = new Set();
  if (typeof html === 'string') {
    for (const match of html.matchAll(FILE_URL_RE)) ids.add(match[1]);
  }
  return [...ids];
}

class StoreFileService {
  constructor() {
    this.storage = getStorageBackend();
  }

  get include() {
    return { file: true, image: true, _count: { select: { references: true } } };
  }

  async list(organizationId, query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(PAGE_SIZE, Math.max(1, Number(query.pageSize) || PAGE_SIZE));
    const where = { organizationId };
    if (query.type === 'image') where.image = { isNot: null };
    if (query.type === 'pdf') where.extension = 'pdf';
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { altText: { contains: q, mode: 'insensitive' } },
      ];
    }
    const orderBy = SORTS[query.sort] || SORTS.created_desc;
    const [rows, total] = await Promise.all([
      prisma.storeFile.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.include,
      }),
      prisma.storeFile.count({ where }),
    ]);
    return { files: rows.map((row) => this.serialize(row)), total, page, pageSize };
  }

  async get(organizationId, id) {
    const row = await prisma.storeFile.findFirst({
      where: { id, organizationId },
      include: { ...this.include, references: true },
    });
    if (!row) throw new NotFoundError('File not found');
    return { ...this.serialize(row), references: await this._resolveReferences(row.references) };
  }

  /** Public serving lookup: id + hash act as the capability. */
  async getPublic(id, hash) {
    const row = await prisma.storeFile.findUnique({
      where: { id },
      include: { file: true, image: true },
    });
    if (!row || row.file.hash !== hash) throw new NotFoundError('File not found');
    return row;
  }

  async createFromBuffer(organizationId, { buffer, originalName, claimedMimeType, userId }) {
    if (!buffer || !buffer.length) throw new ValidationError('The file is empty');
    if (buffer.length > MAX_FILE_BYTES) {
      throw new ValidationError(
        `File is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`
      );
    }
    const mimeType = await imageService.sniffMimeType(buffer);
    const extension = ALLOWED_MIME_TO_EXT[mimeType];
    if (!extension) {
      throw new ValidationError('Only JPG, PNG, GIF, WebP images and PDF files are supported');
    }
    if (claimedMimeType && claimedMimeType !== mimeType) {
      logger.warn('Store file MIME mismatch', { claimed: claimedMimeType, actual: mimeType });
    }

    const name = displayName(originalName);
    let data;
    if (isImageMime(mimeType)) {
      const image = await imageService.processUpload(
        buffer,
        originalName,
        mimeType,
        STORE_FILE_USAGE
      );
      const meta = await sharp(buffer)
        .metadata()
        .catch(() => ({}));
      data = {
        fileId: image.fileId,
        imageId: image.id,
        width: meta.width ?? null,
        height: meta.height ?? null,
      };
    } else {
      const file = await this._storeDocument(buffer, mimeType, extension, originalName);
      data = { fileId: file.id, imageId: null, width: null, height: null };
    }

    const row = await prisma.storeFile.create({
      data: { organizationId, name, extension, createdById: userId || null, ...data },
      include: this.include,
    });
    logger.info('Store file created', {
      event: 'store_file_created',
      storeFileId: row.id,
      organizationId,
      extension,
      sizeBytes: buffer.length,
    });
    return this.serialize(row);
  }

  async createFromUrl(organizationId, { url, userId }) {
    const { buffer, contentType, finalUrl } = await fetchPublicResource(url, {
      maxBytes: MAX_FILE_BYTES,
    });
    let originalName = 'file';
    try {
      originalName = path.basename(new URL(finalUrl).pathname) || 'file';
    } catch {
      // keep default
    }
    return this.createFromBuffer(organizationId, {
      buffer,
      originalName,
      claimedMimeType: contentType ? contentType.split(';')[0].trim() : null,
      userId,
    });
  }

  async update(organizationId, id, data) {
    const existing = await prisma.storeFile.findFirst({
      where: { id, organizationId },
      select: { id: true, imageId: true },
    });
    if (!existing) throw new NotFoundError('File not found');
    const patch = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.altText !== undefined) {
      const trimmed = data.altText === null ? '' : String(data.altText).trim();
      patch.altText = trimmed.length ? trimmed : null;
    }
    if ((data.focalX !== undefined || data.focalY !== undefined) && existing.imageId) {
      const focal = {};
      if (data.focalX !== undefined) focal.focalX = data.focalX;
      if (data.focalY !== undefined) focal.focalY = data.focalY;
      await prisma.image.update({ where: { id: existing.imageId }, data: focal });
    }
    const row = await prisma.storeFile.update({
      where: { id },
      data: patch,
      include: { ...this.include, references: true },
    });
    return { ...this.serialize(row), references: await this._resolveReferences(row.references) };
  }

  /** Deletes the file row (+ its Image row); bytes are left to the orphan cleanup. */
  async remove(organizationId, id) {
    const existing = await prisma.storeFile.findFirst({
      where: { id, organizationId },
      select: { id: true, imageId: true, _count: { select: { references: true } } },
    });
    if (!existing) throw new NotFoundError('File not found');
    await prisma.$transaction(async (tx) => {
      await tx.storeFile.delete({ where: { id } });
      if (existing.imageId)
        await tx.image.delete({ where: { id: existing.imageId } }).catch(() => {});
    });
    logger.info('Store file deleted', {
      event: 'store_file_deleted',
      storeFileId: id,
      organizationId,
    });
    return { referenceCount: existing._count.references };
  }

  async removeMany(organizationId, ids) {
    const deleted = [];
    const failed = [];
    for (const id of ids) {
      try {
        await this.remove(organizationId, id);
        deleted.push(id);
      } catch (error) {
        failed.push({ id, message: error.message });
      }
    }
    return { deleted, failed };
  }

  /**
   * Rebuild the references of one content record. `fields` maps a field name
   * to either an HTML string (ids are extracted) or an explicit file id.
   */
  async syncReferences(kind, targetId, fields, organizationId = null) {
    const wanted = [];
    for (const [field, value] of Object.entries(fields)) {
      if (!value) continue;
      const ids = typeof value === 'string' && /[<>]/.test(value) ? fileIdsInHtml(value) : [value];
      for (const fileId of ids) wanted.push({ fileId, field });
    }
    const candidateIds = [...new Set(wanted.map((w) => w.fileId))];
    const known = candidateIds.length
      ? await prisma.storeFile.findMany({
          where: { id: { in: candidateIds }, ...(organizationId ? { organizationId } : {}) },
          select: { id: true },
        })
      : [];
    const knownIds = new Set(known.map((k) => k.id));
    const rows = wanted
      .filter((w) => knownIds.has(w.fileId))
      .map((w) => ({ ...w, kind, targetId }));
    await prisma.$transaction([
      prisma.storeFileReference.deleteMany({ where: { kind, targetId } }),
      ...(rows.length
        ? [prisma.storeFileReference.createMany({ data: rows, skipDuplicates: true })]
        : []),
    ]);
    return rows.length;
  }

  async clearReferences(kind, targetId) {
    await prisma.storeFileReference.deleteMany({ where: { kind, targetId } });
  }

  /** Bytes + headers for the public route. */
  async getData(row) {
    if (row.image) {
      const data = await imageService.getVariantData(row.image.id, 'original');
      return data ? { buffer: data.buffer, contentType: data.contentType } : null;
    }
    const data = await this.storage.get(documentKey(row.file.hash, row.extension));
    return data ? { buffer: data.buffer, contentType: row.file.mimeType } : null;
  }

  publicPath(row) {
    return `/files/${row.id}/${row.file.hash}/${slugify(row.name) || 'file'}.${row.extension}`;
  }

  url(row) {
    if (process.env.BUCKET_PUBLIC_URL) {
      const key = row.image
        ? `original/${row.file.hash}.${row.extension}`
        : documentKey(row.file.hash, row.extension);
      return this.storage.getPublicUrl(key);
    }
    return `${backendPublicUrl()}${this.publicPath(row)}`;
  }

  serialize(row) {
    const url = this.url(row);
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      extension: row.extension,
      kind: row.image ? 'image' : 'document',
      mimeType: row.file.mimeType,
      sizeBytes: row.file.sizeBytes,
      width: row.width,
      height: row.height,
      altText: row.altText,
      url,
      downloadUrl: `${backendPublicUrl()}${this.publicPath(row)}?download=1`,
      thumbUrl: row.image
        ? imageService.servingUrl({ ...row.image, file: row.file }, 'thumb')
        : null,
      previewUrl: row.image
        ? imageService.servingUrl({ ...row.image, file: row.file }, 'card')
        : null,
      focalX: row.image ? row.image.focalX : null,
      focalY: row.image ? row.image.focalY : null,
      referenceCount: row._count ? row._count.references : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async _storeDocument(buffer, mimeType, extension, originalName) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    const key = documentKey(hash, extension);
    if (!(await this.storage.exists(key))) await this.storage.put(key, buffer, mimeType);
    const existing = await prisma.file.findUnique({ where: { hash } });
    if (existing) return existing;
    return prisma.file.create({
      data: { hash, mimeType, sizeBytes: buffer.length, originalName: originalName || null },
    });
  }

  async _resolveReferences(references) {
    if (!references?.length) return [];
    const byKind = new Map();
    for (const ref of references) {
      if (!byKind.has(ref.kind)) byKind.set(ref.kind, new Set());
      byKind.get(ref.kind).add(ref.targetId);
    }
    const titles = new Map();
    if (byKind.has('PAGE')) {
      const pages = await prisma.page.findMany({
        where: { id: { in: [...byKind.get('PAGE')] } },
        select: { id: true, title: true },
      });
      for (const page of pages)
        titles.set(`PAGE:${page.id}`, {
          title: page.title,
          href: `/admin/online-store/pages/${page.id}`,
        });
    }
    if (byKind.has('BLOG_POST') && prisma.blogPost) {
      const posts = await prisma.blogPost.findMany({
        where: { id: { in: [...byKind.get('BLOG_POST')] } },
        select: { id: true, title: true },
      });
      for (const post of posts)
        titles.set(`BLOG_POST:${post.id}`, {
          title: post.title,
          href: `/admin/content/blog-posts/${post.id}`,
        });
    }
    const seen = new Set();
    const out = [];
    for (const ref of references) {
      const key = `${ref.kind}:${ref.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = titles.get(key);
      if (!resolved) continue;
      out.push({ kind: ref.kind, targetId: ref.targetId, ...resolved });
    }
    return out;
  }
}

export default new StoreFileService();
