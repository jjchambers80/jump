// The signed-in user's own account (spec 030 feature A).
//
// Every handler acts on req.user.id. There is no :userId parameter and the
// body never names a subject; an administrator editing someone else goes
// through /users (roles) — personal data is self-service only. No role gate
// beyond authentication and no X-Jump-Org scoping: an account is not
// organization data.

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { uploadAvatar } from '../../middleware/imageUpload.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { ValidationError } from '../../middleware/errorHandler.js';
import {
  validateEmailChange,
  validateEmailConfirm,
  validateUpdateAccount,
} from '../validators/accountValidators.js';
import accountService from '../../services/AccountService.js';
import imageService from '../../services/ImageService.js';

const router = Router();
const emailChangeLimiter = makeLimiter('ACCOUNT_EMAIL_CHANGE', LIMITS.ACCOUNT_EMAIL_CHANGE);

const wrap = (handler) => (req, res, next) => handler(req, res, next).catch(next);

/**
 * POST /account/email/confirm — public: the link may open in another browser
 * or while signed out; the token identifies the user.
 */
router.post(
  '/email/confirm',
  validateEmailConfirm,
  wrap(async (req, res) => {
    res.json(await accountService.confirmEmailChange(req.body.token));
  })
);

router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  res.json(await accountService.get(req.user.id));
}));

router.patch('/', validateUpdateAccount, wrap(async (req, res) => {
  res.json(await accountService.update(req.user.id, req.body));
}));

router.post('/email', emailChangeLimiter, validateEmailChange, wrap(async (req, res) => {
  res.json(await accountService.requestEmailChange(req.user.id, req.body.email));
}));

router.post('/email/resend', emailChangeLimiter, wrap(async (req, res) => {
  res.json(await accountService.resendEmailChange(req.user.id));
}));

router.delete('/email/pending', wrap(async (req, res) => {
  res.json(await accountService.cancelEmailChange(req.user.id));
}));

router.post('/avatar', uploadAvatar, wrap(async (req, res) => {
  if (!req.file) throw new ValidationError('No photo uploaded');
  const image = await imageService.processUpload(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    'avatar'
  );
  const { account, previousAvatarImageId } = await accountService.setAvatar(req.user.id, image.id);
  if (previousAvatarImageId && previousAvatarImageId !== image.id) {
    await imageService.deleteImage(previousAvatarImageId).catch(() => {});
  }
  res.json(account);
}));

router.delete('/avatar', wrap(async (req, res) => {
  const { account, previousAvatarImageId } = await accountService.setAvatar(req.user.id, null);
  if (previousAvatarImageId) {
    await imageService.deleteImage(previousAvatarImageId).catch(() => {});
  }
  res.json(account);
}));

export default router;
