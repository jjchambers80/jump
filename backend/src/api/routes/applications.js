// Public application routes (spec 011)
//
//   GET  /events/:eventId/applications/forms         forms a visitor can apply to
//   GET  /events/:eventId/applications/forms/:slug   one form with tiers + questions
//   POST /events/:eventId/applications               submit (JSON, or multipart with `payload` + photos)
//   GET  /applications/:id/status?token=             guest status page
//   POST /applications/:id/resume?token=             new Checkout URL for an unfinished paid application
//   POST /applications/:id/pay?token=                pay-now Checkout URL (approved, payment due)
//
// Unauthenticated. Submission is rate-limited per client IP (the storefront
// proxies through Next, so the signed X-Jump-Client-Ip header is honoured).

import express from 'express';
import multer from 'multer';
import applicationFormService from '../../services/ApplicationFormService.js';
import applicationService from '../../services/ApplicationService.js';
import { MAX_FILES_PER_SUBMISSION, MAX_PHOTO_MB } from '../../config/applications.js';
import { ValidationError } from '../../middleware/errorHandler.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { requestMeta } from '../../services/LegalAcceptanceService.js';
import { gateByEventParam } from '../../middleware/storefrontGate.js';

export const eventApplicationsRouter = express.Router({ mergeParams: true });
export const applicationStatusRouter = express.Router();

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Per-IP cap on submissions (spec 020 factory; RATE_LIMIT_APPLICATION_SUBMIT_* overrides).
const submitLimiter = makeLimiter('APPLICATION_SUBMIT', LIMITS.APPLICATION_SUBMIT);
const boothLimiter = makeLimiter('BOOTH_CHOOSE', { ...LIMITS.BOOTH_CHOOSE, skipFailedRequests: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: MAX_FILES_PER_SUBMISSION },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new ValidationError('Only JPG, PNG, GIF, and WebP images are allowed'));
  },
});

/** Accept JSON or multipart (`payload` JSON string + `profilePhotos` + `answer:<questionId>` files). */
function parseSubmission(req, res, next) {
  if (!req.is('multipart/form-data')) {
    req.submission = { body: req.body || {}, files: { profilePhotos: [], answerPhotos: {} } };
    return next();
  }
  upload.any()(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const msg = error.code === 'LIMIT_FILE_SIZE' ? `Each photo must be ${MAX_PHOTO_MB} MB or smaller` : error.message;
      return next(new ValidationError(msg));
    }
    if (error) return next(error);
    let body;
    try {
      body = req.body?.payload ? JSON.parse(req.body.payload) : {};
    } catch {
      return next(new ValidationError('payload must be JSON'));
    }
    const files = { profilePhotos: [], answerPhotos: {} };
    for (const file of req.files || []) {
      if (file.fieldname === 'profilePhotos') files.profilePhotos.push(file);
      else if (file.fieldname.startsWith('answer:')) files.answerPhotos[file.fieldname.slice(7)] = file;
      else return next(new ValidationError(`Unexpected file field ${file.fieldname}`));
    }
    req.submission = { body, files };
    next();
  });
}

eventApplicationsRouter.get('/forms', gateByEventParam, async (req, res, next) => {
  try {
    res.json({ data: await applicationFormService.publicForms(req.params.eventId) });
  } catch (error) {
    next(error);
  }
});

eventApplicationsRouter.get('/forms/:slug', gateByEventParam, async (req, res, next) => {
  try {
    res.json(await applicationFormService.publicForm(req.params.eventId, req.params.slug));
  } catch (error) {
    next(error);
  }
});

eventApplicationsRouter.post('/', submitLimiter, gateByEventParam, parseSubmission, async (req, res, next) => {
  try {
    // The consent trail records a hashed IP and the user agent (spec 024 phase 3).
    const result = await applicationService.submit(req.params.eventId, req.submission.body, req.submission.files, { requestMeta: requestMeta(req) });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

applicationStatusRouter.get('/:id/status', async (req, res, next) => {
  try {
    res.json(await applicationService.statusView(req.params.id, req.query.token));
  } catch (error) {
    next(error);
  }
});

applicationStatusRouter.post('/:id/resume', submitLimiter, async (req, res, next) => {
  try {
    res.json(await applicationService.resumeCheckout(req.params.id, req.query.token));
  } catch (error) {
    next(error);
  }
});

applicationStatusRouter.post('/:id/pay', submitLimiter, async (req, res, next) => {
  try {
    res.json(await applicationService.payNow(req.params.id, req.query.token));
  } catch (error) {
    next(error);
  }
});

/** Hold and purchase a published booth through an emailed guest status link. */
applicationStatusRouter.post('/:id/booth', boothLimiter, async (req, res, next) => {
  try {
    res.json(await applicationService.chooseBooth(req.params.id, req.query.token, req.body?.boothId));
  } catch (error) {
    next(error);
  }
});
