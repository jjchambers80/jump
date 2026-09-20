// Two-step authentication (spec 030 C). Mounted at /account/two-step BEFORE
// the /account router so the pending-allowed endpoints (verify, passkey
// options, trusted check) can accept a session whose second step is not
// done yet; everything else needs a fully signed-in user, and the switches
// need a recent-auth proof like the other sign-in-method changes.

import { Router } from 'express';
import { requireAuth, requireAuthAllowPending } from '../../middleware/auth.js';
import { requireRecentAuth } from '../../middleware/recentAuth.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { ValidationError } from '../../middleware/errorHandler.js';
import twoStepService from '../../services/TwoStepService.js';

const router = Router();
const wrap = (handler) => (req, res, next) => handler(req, res, next).catch(next);
const verifyLimiter = makeLimiter('TWO_STEP_VERIFY', LIMITS.TWO_STEP_VERIFY);

function pickFactor(body) {
  const out = {};
  if (typeof body?.code === 'string') out.code = body.code;
  if (typeof body?.recoveryCode === 'string') out.recoveryCode = body.recoveryCode;
  if (body?.passkey && typeof body.passkey === 'object') out.passkey = body.passkey;
  return out;
}

// ---- Pending-allowed: completing the second step ----

router.post('/verify', verifyLimiter, requireAuthAllowPending, wrap(async (req, res) => {
  const factor = pickFactor(req.body);
  if (Object.keys(factor).length === 0) throw new ValidationError('Provide an authenticator code, a recovery code or a passkey');
  res.json(await twoStepService.verify(req.user.id, { ...factor, rememberDevice: req.body?.rememberDevice === true }, req));
}));

router.post('/passkey-options', verifyLimiter, requireAuthAllowPending, wrap(async (req, res) => {
  res.json(await twoStepService.passkeyOptions(req.user.id));
}));

router.post('/trusted-check', verifyLimiter, requireAuthAllowPending, wrap(async (req, res) => {
  res.json(await twoStepService.trustedCheck(req.user.id, req.body?.token, req));
}));

// ---- Fully signed in ----

router.get('/', requireAuth, wrap(async (req, res) => {
  res.json(await twoStepService.status(req.user.id));
}));

router.post('/setup', requireAuth, requireRecentAuth, wrap(async (req, res) => {
  res.json(await twoStepService.setup(req.user.id));
}));

router.post('/enable', requireAuth, requireRecentAuth, wrap(async (req, res) => {
  if (typeof req.body?.code !== 'string') throw new ValidationError('Enter the 6-digit code from your app');
  res.json(await twoStepService.enable(req.user.id, req.body.code, req));
}));

router.post('/disable', requireAuth, requireRecentAuth, wrap(async (req, res) => {
  const factor = pickFactor(req.body);
  if (!factor.code && !factor.recoveryCode) throw new ValidationError('Enter a current code to turn two-step off');
  await twoStepService.disable(req.user.id, factor, req);
  res.status(204).end();
}));

router.post('/recovery-codes', requireAuth, requireRecentAuth, wrap(async (req, res) => {
  res.json(await twoStepService.regenerateRecoveryCodes(req.user.id, req));
}));

router.delete('/trusted-devices/:id', requireAuth, requireRecentAuth, wrap(async (req, res) => {
  await twoStepService.revokeTrustedDevice(req.user.id, req.params.id, req);
  res.status(204).end();
}));

export default router;
