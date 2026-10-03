// Spec 043: lets one router accept a Jump CLI developer token
// (`Authorization: Bearer jmp_…`) for `scope`. Mount it before requireAuth
// and skip requireAuth when req.user.developerTokenId is set. Every other router
// refuses these tokens, because requireAuth only verifies session JWTs.

import { AuthenticationError } from './errorHandler.js';
import developerTokenService, { TOKEN_PREFIX } from '../services/DeveloperTokenService.js';

export const allowDeveloperToken = (scope) => async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith(`Bearer ${TOKEN_PREFIX}`)) return next();
  try {
    const user = await developerTokenService.authenticate(header.slice(7), scope);
    if (!user) {
      const error = new AuthenticationError('This developer token is invalid, expired or revoked. Run `jump login` again.');
      error.code = 'DEVELOPER_TOKEN_INVALID';
      throw error;
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

