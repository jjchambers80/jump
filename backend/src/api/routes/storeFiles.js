// Content › Files (spec 025).
//   adminFilesRouter  → mounted at /admin/files (staff, org-scoped)
//   publicFilesRouter → mounted at /files (public, hash-protected serving)

import { Router } from 'express';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { activeOrgFor } from './adminScope.js';
import storeFileService from '../../services/StoreFileService.js';
import {
  validateBulkIds,
  validateFromUrl,
  validateUpdateStoreFile,
} from '../validators/storeFileValidators.js';
import { MAX_FILES_PER_UPLOAD, MAX_FILE_BYTES, MAX_FILE_MB } from '../../utils/fileLimits.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD },
});

function parseFiles(req, res, next) {
  upload.array('files', MAX_FILES_PER_UPLOAD)(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE')
        return next(new ValidationError(`Each file must be ${MAX_FILE_MB} MB or smaller`));
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new ValidationError(`Upload up to ${MAX_FILES_PER_UPLOAD} files at a time`));
      }
      return next(new ValidationError(error.message));
    }
    next(error);
  });
}

const fromUrlLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: { message: 'Too many URL uploads — try again in a minute' },
});

export const adminFilesRouter = Router();
adminFilesRouter.use(requireAuth);
adminFilesRouter.use(requireOrganizer);

/** GET /admin/files — list (q, type, sort, page). */
adminFilesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await storeFileService.list(await activeOrgFor(req), req.query));
  } catch (error) {
    next(error);
  }
});

/** POST /admin/files — multipart files[]; per-file success/failure. */
adminFilesRouter.post('/', parseFiles, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    if (!req.files?.length) throw new ValidationError('No files uploaded');
    const files = [];
    const errors = [];
    for (const file of req.files) {
      try {
        files.push(
          await storeFileService.createFromBuffer(organizationId, {
            buffer: file.buffer,
            originalName: file.originalname,
            claimedMimeType: file.mimetype,
            userId: req.user.id,
          })
        );
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        errors.push({ name: file.originalname, message: error.message });
      }
    }
    if (!files.length && errors.length) throw new ValidationError(errors[0].message, errors);
    res.status(201).json({ files, errors });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/files/from-url — fetch a public URL server-side. */
adminFilesRouter.post('/from-url', fromUrlLimiter, validateFromUrl, async (req, res, next) => {
  try {
    const organizationId = await activeOrgFor(req);
    res
      .status(201)
      .json(
        await storeFileService.createFromUrl(organizationId, {
          url: req.body.url,
          userId: req.user.id,
        })
      );
  } catch (error) {
    next(error);
  }
});

/** POST /admin/files/bulk-delete — { ids }. */
adminFilesRouter.post('/bulk-delete', validateBulkIds, async (req, res, next) => {
  try {
    res.json(await storeFileService.removeMany(await activeOrgFor(req), req.body.ids));
  } catch (error) {
    next(error);
  }
});

adminFilesRouter.get('/:fileId', async (req, res, next) => {
  try {
    res.json(await storeFileService.get(await activeOrgFor(req), req.params.fileId));
  } catch (error) {
    next(error);
  }
});

adminFilesRouter.patch('/:fileId', validateUpdateStoreFile, async (req, res, next) => {
  try {
    res.json(await storeFileService.update(await activeOrgFor(req), req.params.fileId, req.body));
  } catch (error) {
    next(error);
  }
});

adminFilesRouter.delete('/:fileId', async (req, res, next) => {
  try {
    await storeFileService.remove(await activeOrgFor(req), req.params.fileId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export const publicFilesRouter = Router();

/**
 * GET /files/:id/:hash/:filename — public, immutable. The hash is the
 * capability; the filename segment is cosmetic. ?download=1 → attachment.
 * Not gated by private store mode (Shopify CDN parity).
 */
publicFilesRouter.get('/:id/:hash/:filename', async (req, res, next) => {
  try {
    const row = await storeFileService.getPublic(req.params.id, req.params.hash);
    const data = await storeFileService.getData(row);
    if (!data) throw new NotFoundError('File not found');

    const etag = `"${row.file.hash}"`;
    const filename = `${row.name.replace(/["\r\n]/g, '')}.${row.extension}`;
    const disposition = req.query.download ? 'attachment' : 'inline';
    res.set({
      'Content-Type': data.contentType,
      'Content-Length': String(data.buffer.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.send(data.buffer);
  } catch (error) {
    next(error);
  }
});
