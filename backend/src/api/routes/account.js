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
  validatePasskeyResponse,
  validateProviderParam,
  validateSecondaryEmail,
  validateSetPassword,
  validateTokenBody,
  validateUpdateAccount,
} from '../validators/accountValidators.js';
import { requireRecentAuth } from '../../middleware/recentAuth.js';
import passkeyService from '../../services/PasskeyService.js';
import securityService from '../../services/SecurityService.js';
import accountService from '../../services/AccountService.js';
import imageService from '../../services/ImageService.js';
import sessionService from '../../services/SessionService.js';
import securityEventService from '../../services/SecurityEventService.js';
import emailService from '../../services/EmailService.js';

const router = Router();
const emailChangeLimiter = makeLimiter('ACCOUNT_EMAIL_CHANGE', LIMITS.ACCOUNT_EMAIL_CHANGE);
const reauthLimiter = makeLimiter('ACCOUNT_REAUTH', LIMITS.ACCOUNT_REAUTH);
const passkeyLimiter = makeLimiter('PASSKEY_CEREMONY', LIMITS.PASSKEY_CEREMONY);

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

/** Public for the same reason: the secondary address confirms from its own inbox. */
router.post(
  '/secondary-email/confirm',
  validateTokenBody,
  wrap(async (req, res) => {
    res.json(await securityService.confirmSecondaryEmail(req.body.token));
  })
);

router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  res.json(await accountService.get(req.user.id));
}));

router.patch('/', validateUpdateAccount, wrap(async (req, res) => {
  res.json(await accountService.update(req.user.id, req.body));
}));

router.post('/email', emailChangeLimiter, requireRecentAuth, validateEmailChange, wrap(async (req, res) => {
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

// ---- Security overview + step-up (spec 030 B) ----

router.get('/security', wrap(async (req, res) => {
  res.json(await securityService.overview(req.user.id));
}));

router.post('/reauth/start', reauthLimiter, wrap(async (req, res) => {
  res.json(await securityService.reauthStart(req.user.id, { method: req.body?.method }));
}));

router.post('/reauth', reauthLimiter, wrap(async (req, res) => {
  res.json(await securityService.reauth(req.user.id, req.body || {}, req));
}));

// ---- Password ----

router.post('/password', requireRecentAuth, validateSetPassword, wrap(async (req, res) => {
  res.json(await securityService.setPassword(req.user.id, req.body.password, req));
}));

router.delete('/password', requireRecentAuth, wrap(async (req, res) => {
  res.json(await securityService.removePassword(req.user.id, req));
}));

// ---- Passkeys ----

router.get('/passkeys', wrap(async (req, res) => {
  res.json({ passkeys: await passkeyService.list(req.user.id) });
}));

router.post('/passkeys/register/options', passkeyLimiter, requireRecentAuth, wrap(async (req, res) => {
  const user = await accountService.get(req.user.id);
  res.json(await passkeyService.registrationOptions({ id: user.id, email: user.email, name: user.name }));
}));

router.post('/passkeys/register/verify', passkeyLimiter, requireRecentAuth, validatePasskeyResponse, wrap(async (req, res) => {
  const user = await accountService.get(req.user.id);
  const passkey = await passkeyService.verifyRegistration({ id: user.id, email: user.email }, {
    response: req.body.response,
    label: req.body.label,
    origin: req.get('origin'),
    userAgent: req.get('user-agent'),
  });
  await securityEventService.record(req.user.id, 'PASSKEY_ADDED', { req, meta: { passkeyId: passkey.id } });
  emailService.sendSecurityNotice({ to: user.email, title: 'A passkey was added', body: `A passkey ("${passkey.label}") was added to your Jump account. If this wasn't you, sign in and review Account › Security.` }).catch(() => {});
  res.status(201).json(passkey);
}));

router.patch('/passkeys/:id', wrap(async (req, res) => {
  res.json(await passkeyService.rename(req.user.id, req.params.id, req.body?.label));
}));

router.delete('/passkeys/:id', requireRecentAuth, wrap(async (req, res) => {
  await passkeyService.remove(req.user.id, req.params.id);
  await securityEventService.record(req.user.id, 'PASSKEY_REMOVED', { req, meta: { passkeyId: req.params.id } });
  emailService.sendSecurityNotice({ to: req.user.email, title: 'A passkey was removed', body: 'A passkey was removed from your Jump account. If this wasn\'t you, sign in and review Account › Security.' }).catch(() => {});
  res.status(204).end();
}));

// ---- Connected providers ----

router.delete('/providers/:provider', requireRecentAuth, validateProviderParam, wrap(async (req, res) => {
  await securityService.disconnectProvider(req.user.id, req.params.provider, req);
  res.status(204).end();
}));

// ---- Secondary email ----

router.post('/secondary-email', requireRecentAuth, validateSecondaryEmail, wrap(async (req, res) => {
  res.json(await securityService.setSecondaryEmail(req.user.id, req.body.email, req));
}));

router.post('/secondary-email/resend', emailChangeLimiter, wrap(async (req, res) => {
  await securityService.resendSecondaryVerification(req.user.id);
  res.status(204).end();
}));

router.delete('/secondary-email', requireRecentAuth, wrap(async (req, res) => {
  await securityService.removeSecondaryEmail(req.user.id, req);
  res.status(204).end();
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
