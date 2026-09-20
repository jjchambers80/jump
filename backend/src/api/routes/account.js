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
import sessionService from '../../services/SessionService.js';
import securityEventService from '../../services/SecurityEventService.js';
import emailService from '../../services/EmailService.js';

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

// ---- Devices (spec 030 D) ----

router.get('/sessions', wrap(async (req, res) => {
  res.json({ sessions: await sessionService.list(req.user.id, req.user.sid) });
}));

router.delete('/sessions/:id', wrap(async (req, res) => {
  const result = await sessionService.revoke(req.user.id, req.params.id, 'user');
  await securityEventService.record(req.user.id, 'SESSION_REVOKED', {
    req,
    meta: { sid: req.params.id, current: req.params.id === req.user.sid },
  });
  res.json({ ...result, current: req.params.id === req.user.sid });
}));

router.post('/sessions/revoke-others', wrap(async (req, res) => {
  const result = await sessionService.revokeOthers(req.user.id, req.user.sid, 'logout-all');
  await securityEventService.record(req.user.id, 'SESSIONS_REVOKED_ALL', { req, meta: result });
  if (result.revoked > 0) {
    emailService
      .sendSecurityNotice({
        to: req.user.email,
        title: 'You logged out of your other devices',
        body: `${result.revoked} other ${result.revoked === 1 ? 'session was' : 'sessions were'} signed out of your Jump account. If this wasn't you, sign in and check Account › Security › Devices.`,
      })
      .catch(() => {});
  }
  res.json(result);
}));

export default router;
