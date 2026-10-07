// OAuth 2.1 authorization server endpoints (spec 045). Implemented locally
// because the MCP SDK provides resource-server helpers, not a Prisma-backed
// authorization server with CIMD and rotating opaque refresh tokens.

import express, { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRecentAuth } from '../../middleware/recentAuth.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';
import { AGENT_RESOURCE } from '../../services/AgentAuthService.js';
import oAuthClientService, { OAuthClientError } from '../../services/OAuthClientService.js';
import oAuthService, {
  OAUTH_SCOPES,
  OAuthProtocolError,
  oauthIssuer,
} from '../../services/OAuthService.js';

const router = Router();
const form = express.urlencoded({ extended: false, limit: '32kb' });
const registrationLimiter = makeLimiter('OAUTH_REGISTER', LIMITS.OAUTH_REGISTER);
const tokenLimiter = makeLimiter('OAUTH_TOKEN', LIMITS.OAUTH_TOKEN);
// GET /oauth/authorize can make the server fetch a client metadata document.
const authorizeLimiter = makeLimiter('OAUTH_AUTHORIZE', LIMITS.OAUTH_AUTHORIZE);

// Deploy dark: when the environment gate is off, the authorization server is
// indistinguishable from an unmounted feature (including discovery).
router.use((req, res, next) => {
  const oauthPath = req.path.startsWith('/oauth/') || req.path.startsWith('/.well-known/oauth-');
  if (oauthPath && process.env.AGENT_ACCESS_ENABLED !== 'true') return res.status(404).end();
  next();
});

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

function oauthError(res, error) {
  noStore(res);
  const known = error instanceof OAuthProtocolError || error instanceof OAuthClientError;
  const status = known ? error.statusCode : 500;
  return res.status(status).json({
    error: known ? error.code : 'server_error',
    error_description: known ? error.message : 'The authorization server could not complete the request',
  });
}

const handle = (fn, { protocolErrors = false } = {}) => async (req, res, next) => {
  try { await fn(req, res); } catch (error) {
    if (protocolErrors) return oauthError(res, error);
    next(error);
  }
};

router.get('/.well-known/oauth-authorization-server', (req, res) => {
  const issuer = oauthIssuer();
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    scopes_supported: Object.keys(OAUTH_SCOPES),
  });
});

const protectedResource = (req, res) => res.json({
  resource: AGENT_RESOURCE,
  authorization_servers: [oauthIssuer()],
  bearer_methods_supported: ['header'],
  scopes_supported: Object.keys(OAUTH_SCOPES),
});
router.get('/.well-known/oauth-protected-resource', protectedResource);
router.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

router.post('/oauth/register', registrationLimiter, handle(async (req, res) => {
  await oAuthService.assertPlatformEnabled();
  const client = await oAuthClientService.register(req.body);
  res.status(201).json({
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
}, { protocolErrors: true }));

// The protocol entry point validates before redirecting to the session-bearing
// frontend. Tokens/codes are never placed in this redirect.
router.get('/oauth/authorize', authorizeLimiter, async (req, res) => {
  try {
    res.redirect(302, await oAuthService.begin(req.query));
  } catch (error) {
    const redirect = await oAuthService.authorizationErrorRedirect(req.query, error).catch(() => null);
    if (redirect) return res.redirect(302, redirect);
    oauthError(res, error);
  }
});

router.post('/oauth/authorize/prepare', authorizeLimiter, requireAuth, handle(async (req, res) => {
  noStore(res);
  res.json(await oAuthService.prepare(req.user.id, req.body));
}, { protocolErrors: true }));

router.post('/oauth/authorize', requireAuth, requireRecentAuth, handle(async (req, res) => {
  noStore(res);
  res.json({ redirect_to: await oAuthService.approve(req.user.id, req.body) });
}, { protocolErrors: true }));

router.post('/oauth/token', tokenLimiter, form, handle(async (req, res) => {
  noStore(res);
  res.json(await oAuthService.token(req.body));
}, { protocolErrors: true }));

router.post('/oauth/revoke', tokenLimiter, form, handle(async (req, res) => {
  noStore(res);
  await oAuthService.revoke(req.body);
  res.status(200).end();
}, { protocolErrors: true }));

export default router;
