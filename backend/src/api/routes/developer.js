// Jump CLI sign-in and developer tokens (spec 043).
//
//   GET    /developer/authorize?store=   staff session: the store the CLI asked for
//   POST   /developer/authorize          staff session + step-up: one-time code for the loopback redirect
//   POST   /developer/token              public, rate limited: code + PKCE verifier → `jmp_` token (once)
//   GET    /developer/me                 developer token: whoami
//   DELETE /developer/token              developer token: revoke itself (`jump logout`)
//   GET    /admin/developer-tokens       Settings › Developers
//   DELETE /admin/developer-tokens/:id

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrganizer } from '../../middleware/rbac.js';
import { requireRecentAuth } from '../../middleware/recentAuth.js';
import { allowDeveloperToken } from '../../middleware/developerToken.js';
import { AuthenticationError } from '../../middleware/errorHandler.js';
import { makeLimiter, LIMITS } from '../../middleware/rateLimit.js';
import { activeOrgFor } from './adminScope.js';
import developerTokenService from '../../services/DeveloperTokenService.js';

const router = Router();
const tokenLimiter = makeLimiter('DEVELOPER_TOKEN', LIMITS.DEVELOPER_TOKEN);

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

const developerOnly = [
  allowDeveloperToken('themes'),
  (req, res, next) => (req.user?.developerTokenId ? next() : next(new AuthenticationError('A developer token is required'))),
];

router.get('/developer/authorize', requireAuth, requireOrganizer, handle(async (req, res) => {
  res.json({ organization: await developerTokenService.organizationFor(req.user, String(req.query.store || '')) });
}));

router.post('/developer/authorize', requireAuth, requireOrganizer, requireRecentAuth, handle(async (req, res) => {
  const { store, codeChallenge, redirectUri, name } = req.body || {};
  const { code, organization } = await developerTokenService.createCode(req.user, { store, codeChallenge, redirectUri, name });
  res.status(201).json({ code, organization });
}));

router.post('/developer/token', tokenLimiter, handle(async (req, res) => {
  const { code, codeVerifier, redirectUri } = req.body || {};
  res.status(201).json(await developerTokenService.exchange({ code, codeVerifier, redirectUri }));
}));

router.get('/developer/me', developerOnly, handle(async (req, res) => {
  res.json({
    user: { id: req.user.id, email: req.user.email, name: req.user.name },
    organizationId: req.user.organizationId,
    tokenId: req.user.developerTokenId,
  });
}));

router.delete('/developer/token', developerOnly, handle(async (req, res) => {
  await developerTokenService.revokeSelf(req.user.developerTokenId);
  res.status(204).end();
}));

router.get('/admin/developer-tokens', requireAuth, requireOrganizer, handle(async (req, res) => {
  res.json({ tokens: await developerTokenService.list(await activeOrgFor(req), req.user) });
}));

router.delete('/admin/developer-tokens/:id', requireAuth, requireOrganizer, handle(async (req, res) => {
  await developerTokenService.revoke(await activeOrgFor(req), req.user, req.params.id);
  res.status(204).end();
}));

export default router;
