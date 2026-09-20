// Step-up ("recent authentication") for security mutations (spec 030 B).
//
// POST /account/reauth returns a short-lived HS256 proof after the user
// re-proves who they are (password, passkey, or an emailed code). Handlers
// that change sign-in methods require it in X-Jump-Reauth; a missing or
// stale proof is 401 REAUTH_REQUIRED and the UI opens the reauth dialog.

import jwt from 'jsonwebtoken';
import { AuthenticationError } from './errorHandler.js';

export const REAUTH_TTL_S = 10 * 60;

export function issueReauthProof(userId, { secret = process.env.AUTH_SECRET, ttlSeconds = REAUTH_TTL_S } = {}) {
  const token = jwt.sign({ typ: 'reauth', sub: userId }, secret, { algorithm: 'HS256', expiresIn: ttlSeconds });
  return { reauthToken: token, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}

export function verifyReauthProof(token, userId, { secret = process.env.AUTH_SECRET } = {}) {
  if (typeof token !== 'string' || !token) return false;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return decoded.typ === 'reauth' && decoded.sub === userId;
  } catch {
    return false;
  }
}

export const requireRecentAuth = (req, res, next) => {
  if (!req.user?.id) return next(new AuthenticationError());
  if (verifyReauthProof(req.get('x-jump-reauth'), req.user.id)) return next();
  const error = new AuthenticationError('Confirm it’s you to change security settings');
  error.code = 'REAUTH_REQUIRED';
  next(error);
};
