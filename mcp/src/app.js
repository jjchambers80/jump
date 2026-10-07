// Jump MCP server (spec 045 phase D): Streamable HTTP, stateless, one
// McpServer per request. The bearer token is checked here, before the SDK
// runs, so every unauthenticated request gets the 401 challenge clients need
// to start OAuth. agentAuthorize() runs exactly once per request; tools read
// the result from the SDK's pass-through authInfo.

import { createMcpExpressApp, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/express';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import agentAuthService, { AGENT_RESOURCE, AgentAuthorizationError } from '../../backend/src/services/AgentAuthService.js';
import { OAUTH_SCOPES, oauthIssuer } from '../../backend/src/services/OAuthService.js';
import logger from '../../backend/src/utils/logger.js';
import { registerReadTools } from './tools.js';

export const RESOURCE_METADATA_URL = getOAuthProtectedResourceMetadataUrl(new URL(AGENT_RESOURCE));

const list = (value, fallback) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : fallback);
const production = process.env.NODE_ENV === 'production';

function challenge(res, status, error, description, extra = '') {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="${error}"${extra}`);
  res.set('Cache-Control', 'no-store');
  return res.status(status).json({ error, error_description: description });
}

async function authenticate(req, res, next) {
  const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
  if (!match) return challenge(res, 401, 'invalid_token', 'A bearer access token is required');
  try {
    const auth = await agentAuthService.agentAuthorize(match[1], { scope: 'store:read', audience: AGENT_RESOURCE });
    req.auth = {
      token: match[1],
      clientId: auth.clientName,
      scopes: auth.scopes,
      expiresAt: Math.floor(auth.expiresAt.getTime() / 1000),
      resource: new URL(AGENT_RESOURCE),
      extra: auth,
    };
    next();
  } catch (error) {
    if (!(error instanceof AgentAuthorizationError)) return next(error);
    if (error.code === 'invalid_token') return challenge(res, 401, 'invalid_token', error.message);
    if (error.code === 'insufficient_scope') {
      return challenge(res, 403, 'insufficient_scope', error.message, ', scope="store:read"');
    }
    // Switches off (403) or rate limited (429): a plain refusal, so clients
    // do not loop through sign-in again.
    res.set('Cache-Control', 'no-store');
    return res.status(error.statusCode).json({ error: error.code, error_description: error.message });
  }
}

export function createApp() {
  const app = createMcpExpressApp({
    host: '0.0.0.0',
    allowedHosts: list(process.env.MCP_ALLOWED_HOSTS, [new URL(AGENT_RESOURCE).hostname, 'localhost', '127.0.0.1']),
    // Server-side clients send no Origin; a browser-based one must be listed.
    allowedOrigins: list(
      process.env.MCP_ALLOWED_ORIGINS,
      production ? ['claude.ai', 'chatgpt.com'] : ['claude.ai', 'chatgpt.com', 'localhost', '127.0.0.1'],
    ),
    jsonLimit: '256kb',
  });
  app.disable('x-powered-by');

  // RFC 9728 Protected Resource Metadata. Jump's backend is the only
  // authorization server.
  const metadata = (req, res) => res.json({
    resource: AGENT_RESOURCE,
    authorization_servers: [oauthIssuer()],
    bearer_methods_supported: ['header'],
    scopes_supported: Object.keys(OAUTH_SCOPES),
    resource_name: 'Jump store',
  });
  app.get('/.well-known/oauth-protected-resource', metadata);
  app.get(new URL(RESOURCE_METADATA_URL).pathname, metadata);

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  const handler = toNodeHandler(createMcpHandler((ctx) => {
    const server = new McpServer({ name: 'Jump store', version: '1.0.0' });
    // authenticate() always sets req.auth; refuse rather than serve without it.
    if (!ctx.authInfo?.extra?.organizationId) throw new Error('Unauthenticated MCP request reached the handler');
    registerReadTools(server, ctx.authInfo.extra);
    return server;
  }, { onerror: (error) => logger.warn('MCP request error', { error: error.message }) }));

  // express.json() (inside createMcpExpressApp) already consumed the body.
  app.all('/mcp', authenticate, (req, res) => handler(req, res, req.body));

  return app;
}
