import { createHash } from 'crypto';
import sharp from 'sharp';
import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { getStorageBackend } from './storage/index.js';
import { DOCUMENT_MIME_TO_EXT, VIDEO_MIME_TO_EXT } from '../utils/fileLimits.js';

const VARIANTS = {
  thumb: { width: 128, height: 128, fit: 'cover' },
  card: { width: 400, height: 300, fit: 'cover' },
  hero: { width: 1200, height: 630, fit: 'cover' },
};

// Spec 046: uncropped, width-bounded variants for whole-image fits (gallery
// masonry, lightbox, carousel). Generated on first request, then stored, so
// files uploaded before galleries need no backfill. Never enlarged.
export const WIDTH_VARIANTS = { w480: 480, w960: 960, w1600: 1600, w2400: 2400 };

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function originalKey(hash, mimeType) {
  const ext = MIME_TO_EXT[mimeType] || 'bin';
  return `original/${hash}.${ext}`;
}

function variantKey(variant, hash) {
  return `${variant}/${hash}.webp`;
}

/** Intrinsic pixel size of an image buffer; nulls when sharp cannot read it. */
export async function readDimensions(buffer) {
  const meta = await sharp(buffer)
    .metadata()
    .catch(() => ({}));
  if (!meta.width || !meta.height) return { width: null, height: null };
  // EXIF orientations 5-8 are rotated a quarter turn: the browser shows height × width.
  return meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/**
 * `?w=&h=` for an original's serving URL: lets pages reserve the image's box
 * before it loads (the storefront header logo). The serving route ignores the
 * query; `imageVariantUrl` on the frontend drops it for resized variants.
 */
export function dimensionQuery(file) {
  return file?.width > 0 && file?.height > 0 ? `?w=${file.width}&h=${file.height}` : '';
}

class ImageService {
  constructor() {
    this.storage = getStorageBackend();
  }

  /**
   * Validate actual file content matches claimed MIME type.
   * Uses magic bytes via file-type package.
   */
  async sniffMimeType(buffer) {
    const { fileTypeFromBuffer } = await import('file-type');
    const result = await fileTypeFromBuffer(buffer);
    return result ? result.mime : null;
  }

  /**
   * Generate resized variants of an image buffer.
   * Returns array of { variant, buffer } objects.
   */
  async generateVariants(buffer) {
    const results = [];
    for (const [name, config] of Object.entries(VARIANTS)) {
      try {
        const resized = await sharp(buffer)
          .resize(config.width, config.height, { fit: config.fit })
          .webp({ quality: 80 })
          .toBuffer();
        results.push({ variant: name, buffer: resized });
      } catch (error) {
        logger.warn('Variant generation failed, uploading original as fallback', {
          variant: name,
          error: error.message,
        });
        results.push({ variant: name, buffer });
      }
    }
    return results;
  }

  /**
   * Process an image upload: hash, dedup, generate variants, store.
   *
   * @param {Buffer} buffer - Raw file bytes
   * @param {string} originalName - User's filename
   * @param {string} claimedMimeType - MIME type from upload
   * @param {string} usageType - Purpose string (e.g. "venue_logo")
   * @param {number} [focalX=0.5] - Focal point X (0-1)
   * @param {number} [focalY=0.5] - Focal point Y (0-1)
   * @returns {Promise<Object>} Image record with file and serving URLs
   */
  async processUpload(buffer, originalName, claimedMimeType, usageType, focalX = 0.5, focalY = 0.5) {
    const actualMime = await this.sniffMimeType(buffer);
    if (!actualMime || !MIME_TO_EXT[actualMime]) {
      throw new ValidationError(`Unsupported image type: ${actualMime || 'unknown'}`);
    }
    if (actualMime !== claimedMimeType) {
      logger.warn('MIME type mismatch', { claimed: claimedMimeType, actual: actualMime });
    }
    const mimeType = actualMime;

    const hash = hashBuffer(buffer);
    const existingFile = await prisma.file.findUnique({ where: { hash } });
    const dimensions = await readDimensions(buffer);

    if (existingFile) {
      const origKey = originalKey(hash, mimeType);
      if (!(await this.storage.exists(origKey))) {
        await this.storage.put(origKey, buffer, mimeType);
        const variants = await this.generateVariants(buffer);
        await Promise.all(
          variants.map((v) => this.storage.put(variantKey(v.variant, hash), v.buffer, 'image/webp'))
        );
      }

      const fileUpdate = {};
      if (originalName && originalName !== existingFile.originalName) fileUpdate.originalName = originalName;
      if (existingFile.width == null && dimensions.width) Object.assign(fileUpdate, dimensions);
      if (Object.keys(fileUpdate).length) {
        await prisma.file.update({
          where: { id: existingFile.id },
          data: fileUpdate,
        });
      }

      const image = await prisma.image.create({
        data: {
          fileId: existingFile.id,
          usageType,
          focalX,
          focalY,
        },
        include: { file: true },
      });

      logger.info('Image created (deduped file)', {
        event: 'image_created',
        imageId: image.id,
        fileId: existingFile.id,
        hash,
        usageType,
      });

      return this.formatImageResponse(image);
    }

    // New file: upload original + variants, then create records in transaction
    await this.storage.put(originalKey(hash, mimeType), buffer, mimeType);

    const variants = await this.generateVariants(buffer);
    await Promise.all(
      variants.map((v) => this.storage.put(variantKey(v.variant, hash), v.buffer, 'image/webp'))
    );

    const image = await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          hash,
          mimeType,
          sizeBytes: buffer.length,
          originalName: originalName || null,
          ...dimensions,
        },
      });

      return tx.image.create({
        data: {
          fileId: file.id,
          usageType,
          focalX,
          focalY,
        },
        include: { file: true },
      });
    });

    logger.info('Image created (new file)', {
      event: 'image_created',
      imageId: image.id,
      fileId: image.fileId,
      hash,
      sizeBytes: buffer.length,
      usageType,
    });

    return this.formatImageResponse(image);
  }

  /**
   * Get an image by ID with file data.
   */
  async getImage(imageId) {
    const image = await prisma.image.findUnique({
      where: { id: imageId },
      include: { file: true },
    });
    if (!image) throw new NotFoundError('Image not found');
    return this.formatImageResponse(image);
  }

  /**
   * Delete an image record. Does NOT delete the file or stored objects
   * if other images reference the same file.
   */
  async deleteImage(imageId) {
    const image = await prisma.image.findUnique({
      where: { id: imageId },
      select: { id: true, fileId: true },
    });
    if (!image) throw new NotFoundError('Image not found');

    await prisma.image.delete({ where: { id: imageId } });

    logger.info('Image deleted', {
      event: 'image_deleted',
      imageId,
      fileId: image.fileId,
    });
  }

  /**
   * Stream variant bytes for serving.
   * @returns {{ buffer, contentType, hash }} or null
   */
  async getVariantData(imageId, variant) {
    const image = await prisma.image.findUnique({
      where: { id: imageId },
      include: { file: true },
    });
    if (!image) return null;

    const hash = image.file.hash;
    let key;
    if (variant === 'original') {
      key = originalKey(hash, image.file.mimeType);
    } else if (VARIANTS[variant] || WIDTH_VARIANTS[variant]) {
      key = variantKey(variant, hash);
    } else {
      return null;
    }

    let data = await this.storage.get(key);
    if (!data && WIDTH_VARIANTS[variant]) data = await this._buildWidthVariant(image.file, variant, key);
    if (!data) return null;

    return {
      buffer: data.buffer,
      contentType: variant === 'original' ? image.file.mimeType : 'image/webp',
      hash,
    };
  }

  /**
   * Resize the original to fit inside the variant's width and store it.
   * Concurrent first requests do the same idempotent work (content-addressed key).
   */
  async _buildWidthVariant(file, variant, key) {
    const original = await this.storage.get(originalKey(file.hash, file.mimeType));
    if (!original) return null;
    const buffer = await sharp(original.buffer)
      .rotate()
      .resize({ width: WIDTH_VARIANTS[variant], fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    await this.storage.put(key, buffer, 'image/webp');
    return { buffer };
  }

  /**
   * `src` + `srcset` over the width variants for a whole-image fit. Widths at
   * or above the original collapse into one candidate at the original width
   * (variants are never enlarged). Unknown size: every width.
   */
  widthSources(image) {
    const intrinsic = image.file.width || null;
    const candidates = [];
    for (const [variant, width] of Object.entries(WIDTH_VARIANTS)) {
      if (intrinsic && width >= intrinsic) {
        candidates.push({ variant, width: intrinsic });
        break;
      }
      candidates.push({ variant, width });
    }
    const srcset = candidates.map((c) => `${this.servingUrl(image, c.variant)} ${c.width}w`).join(', ');
    const fallback = candidates.find((c) => c.variant === 'w1600') || candidates[candidates.length - 1];
    return { src: this.servingUrl(image, fallback.variant), srcset };
  }

  /**
   * Clean up orphaned files — files with no image references.
   * Returns count of deleted files.
   */
  async cleanupOrphans() {
    const orphans = await prisma.file.findMany({
      where: { images: { none: {} }, storeFiles: { none: {} } },
    });

    let deleted = 0;
    for (const file of orphans) {
      const origKey = originalKey(file.hash, file.mimeType);
      await this.storage.delete(origKey);
      for (const variant of [...Object.keys(VARIANTS), ...Object.keys(WIDTH_VARIANTS)]) {
        await this.storage.delete(variantKey(variant, file.hash));
      }
      // Content › Files documents (spec 025) live under documents/<hash>.<ext>.
      const documentExt = DOCUMENT_MIME_TO_EXT[file.mimeType] || VIDEO_MIME_TO_EXT[file.mimeType];
      if (documentExt) {
        await this.storage.delete(`documents/${file.hash}.${documentExt}`);
      }
      await prisma.file.delete({ where: { id: file.id } });
      deleted++;
    }

    if (deleted > 0) {
      logger.info('Orphan files cleaned up', {
        event: 'orphan_cleanup',
        deletedCount: deleted,
      });
    }

    return deleted;
  }

  /**
   * Build the serving URL for one variant.
   *
   * Default: route through GET /images/:id/:hash/:variant so the backend
   * streams bytes from storage. This works with a private bucket (Railway
   * Buckets deny anonymous reads) and with local disk. Only when
   * BUCKET_PUBLIC_URL is set (a CDN / public bucket) do we emit direct URLs.
   */
  servingUrl(image, variant) {
    if (process.env.BUCKET_PUBLIC_URL) {
      const hash = image.file.hash;
      const key = variant === 'original'
        ? originalKey(hash, image.file.mimeType)
        : variantKey(variant, hash);
      return this.storage.getPublicUrl(key);
    }
    return `/images/${image.id}/${image.file.hash}/${variant}`;
  }

  /**
   * The original's serving URL with its pixel size (`?w=&h=`). Stored as an
   * organization's logoUrl so every storefront header can reserve the logo's
   * box before it loads. Plain `servingUrl` stays clean for CSVs and emails.
   */
  sizedOriginalUrl(image) {
    return `${this.servingUrl(image, 'original')}${dimensionQuery(image.file)}`;
  }

  /**
   * Format image record for API response with serving URLs.
   */
  formatImageResponse(image) {
    const hash = image.file.hash;
    const urls = { original: this.servingUrl(image, 'original') };
    for (const variant of Object.keys(VARIANTS)) {
      urls[variant] = this.servingUrl(image, variant);
    }

    return {
      id: image.id,
      fileId: image.file.id,
      hash,
      mimeType: image.file.mimeType,
      sizeBytes: image.file.sizeBytes,
      originalName: image.file.originalName,
      width: image.file.width ?? null,
      height: image.file.height ?? null,
      usageType: image.usageType,
      focalX: image.focalX,
      focalY: image.focalY,
      urls,
      createdAt: image.createdAt,
    };
  }
}

export default new ImageService();
