// Public staff sign-in helpers that Auth.js cannot do alone (spec 030 B):
// password verification for the `password` Credentials provider (called
// server-to-server by the frontend), passkey assertion → bridge token for
// the `token-bridge` provider, and secondary-email recovery.
//
// Everything here is rate limited per client IP (the frontend forwards the
// browser's address signed, see utils/clientIp.js) and answers generically
// where account existence would otherwise leak.

import { Router } from 'express';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { AuthenticationError } from '../../middleware/errorHandler.js';
import { validatePasskeyResponse, validateTokenBody } from '../validators/accountValidators.js';
import passkeyService from '../../services/PasskeyService.js';
import securityService from '../../services/SecurityService.js';

const router = Router();
const wrap = (handler) => (req, res, next) => handler(req, res, next).catch(next);

const passwordLimiter = makeLimiter('PASSWORD_SIGNIN', LIMITS.PASSWORD_SIGNIN);
const passkeyLimiter = makeLimiter('PASSKEY_CEREMONY', LIMITS.PASSKEY_CEREMONY);
const recoveryLimiter = makeLimiter('ACCOUNT_RECOVERY', LIMITS.ACCOUNT_RECOVERY);

/** Only the frontend may call this: it must present the shared secret. */
function requireFrontend(req, res, next) {
  const key = req.get('x-jump-internal');
  if (!process.env.AUTH_SECRET || key !== process.env.AUTH_SECRET) {
    return next(new AuthenticationError('Not allowed'));
  }
  next();
}

router.post('/password', passwordLimiter, requireFrontend, wrap(async (req, res) => {
  res.json(await securityService.verifyPasswordSignIn(req.body?.email, req.body?.password, req));
}));

router.post('/passkey/options', passkeyLimiter, wrap(async (req, res) => {
  res.json(await passkeyService.authenticationOptions());
}));

router.post('/passkey/verify', passkeyLimiter, validatePasskeyResponse, wrap(async (req, res) => {
  const challengeId = req.body?.challengeId;
  if (typeof challengeId !== 'string' || !challengeId) throw new AuthenticationError('Passkey prompt expired');
  const { user, userVerified } = await passkeyService.verifyAuthentication({
    challengeId,
    response: req.body.response,
    origin: req.get('origin'),
  });
  const bridgeToken = await securityService.issueBridgeToken(user.id, { via: 'passkey', userVerified });
  res.json({ bridgeToken });
}));

router.post('/recover', recoveryLimiter, wrap(async (req, res) => {
  await securityService.requestRecovery(req.body?.email, req);
  // Always the same answer
  res.json({ ok: true });
}));

router.post('/recover/complete', recoveryLimiter, validateTokenBody, wrap(async (req, res) => {
  res.json(await securityService.completeRecovery(req.body.token, req));
}));

export default router;
