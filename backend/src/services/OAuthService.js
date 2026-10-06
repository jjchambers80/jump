// OAuth 2.1 authorization-code and rotating-refresh flows for agent access.
// Raw codes/tokens exist only in responses; Prisma receives SHA-256 code hashes
// and peppered HMAC token hashes.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';
import agentAuthService, {
  AGENT_ACCESS_SETTING,
  AGENT_RESOURCE,
  hashOAuthToken,
} from './AgentAuthService.js';
import oAuthClientService, { redirectAllowed } from './OAuthClientService.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const CONSENT_TTL_SECONDS = 10 * 60;

export const OAUTH_SCOPES = Object.freeze({
  'store:read': 'Read events, venues, content, store settings, and aggregate sales',
  'content:write': 'Create and edit draft or hidden store content',
  'events:write': 'Create and edit draft events, venues, tiers, and add-ons',
  'events:publish': 'Preview publishing or cancelling events before applying it',
  themes: 'Read and edit store themes without changing their rollout',
  'settings:write': 'Edit non-sensitive store settings',
});

export class OAuthProtocolError extends Error {
  constructor(code, description, statusCode = 400) {
    super(description);
    this.name = 'OAuthProtocolError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const tokenValue = (kind) => `jmp_${kind}_${randomBytes(32).toString('base64url')}`;
const enabled = (setting) => setting?.value === true || setting?.value?.enabled === true;
const invalidGrant = () => new OAuthProtocolError('invalid_grant', 'The authorization grant is invalid or expired');

export function oauthIssuer() {
  const configured = process.env.OAUTH_ISSUER || process.env.BACKEND_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3002}`;
}

export function consentUrl() {
  const origin = (process.env.FRONTEND_URL || 'http://localhost:3001').split(',')[0].trim();
  return `${origin.replace(/\/$/, '')}/oauth/consent`;
}

function parseScopes(value) {
  const requested = typeof value === 'string' && value.trim() ? value.trim().split(/\s+/) : ['store:read'];
  const scopes = [...new Set(requested)];
  if (scopes.some((scope) => !Object.hasOwn(OAUTH_SCOPES, scope))) {
    throw new OAuthProtocolError('invalid_scope', 'One or more requested scopes are not supported');
  }
  return scopes;
}

function validPkceChallenge(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function pkceMatches(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const actual = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requestDigest(request) {
  return sha256(JSON.stringify({
    responseType: request.responseType,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    scopes: request.scopes,
    state: request.state,
    codeChallenge: request.codeChallenge,
    resource: request.resource,
  }));
}

async function assertPlatformEnabled() {
  if (process.env.AGENT_ACCESS_ENABLED !== 'true') {
    throw new OAuthProtocolError('access_denied', 'Agent access is disabled', 403);
  }
  const setting = await prisma.platformSetting.findUnique({ where: { key: AGENT_ACCESS_SETTING } });
  if (!enabled(setting)) throw new OAuthProtocolError('access_denied', 'Agent access is disabled', 403);
}

async function assertGrantAllowed(userId, organizationId) {
  await assertPlatformEnabled();
  const [user, organization, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, deletedAt: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { agentAccessEnabled: true, status: true } }),
    prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    }),
  ]);
  if (!user?.isActive || user.deletedAt || !organization?.agentAccessEnabled || organization.status !== 'ACTIVE' || membership?.role !== 'ADMIN') {
    throw new OAuthProtocolError('access_denied', 'You cannot connect an agent to this store', 403);
  }
  await agentAuthService._assertPlanAllows(organizationId);
}

class OAuthService {
  async assertPlatformEnabled() {
    return assertPlatformEnabled();
  }

  async authorizationErrorRedirect(input, error) {
    if (!(error instanceof OAuthProtocolError)) return null;
    const client = await oAuthClientService.resolve(input?.client_id).catch(() => null);
    if (!client || !redirectAllowed(client, input?.redirect_uri)) return null;
    const redirect = new URL(input.redirect_uri);
    redirect.searchParams.set('error', error.code);
    if (typeof input?.state === 'string' && input.state) redirect.searchParams.set('state', input.state);
    redirect.searchParams.set('iss', oauthIssuer());
    return redirect.toString();
  }

  async normalizeAuthorizationRequest(input) {
    const request = {
      responseType: input?.response_type,
      clientId: input?.client_id,
      redirectUri: input?.redirect_uri,
      scopes: parseScopes(input?.scope),
      state: typeof input?.state === 'string' ? input.state : '',
      codeChallenge: input?.code_challenge,
      resource: input?.resource,
    };
    if (request.responseType !== 'code') throw new OAuthProtocolError('unsupported_response_type', 'response_type must be code');
    if (input?.code_challenge_method !== 'S256' || !validPkceChallenge(request.codeChallenge)) {
      throw new OAuthProtocolError('invalid_request', 'PKCE S256 is required');
    }
    if (request.resource !== AGENT_RESOURCE) throw new OAuthProtocolError('invalid_target', 'The requested resource is not supported');
    const client = await oAuthClientService.resolve(request.clientId);
    if (!client || !redirectAllowed(client, request.redirectUri)) {
      throw new OAuthProtocolError('invalid_request', 'The redirect URI is not registered for this client');
    }
    return { request, client };
  }

  async begin(input) {
    await assertPlatformEnabled();
    await this.normalizeAuthorizationRequest(input);
    const url = new URL(consentUrl());
    for (const [key, value] of Object.entries(input || {})) {
      if (typeof value === 'string') url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async prepare(userId, input) {
    await assertPlatformEnabled();
    const { request, client } = await this.normalizeAuthorizationRequest(input);
    const organizations = await prisma.organization.findMany({
      where: {
        status: 'ACTIVE',
        agentAccessEnabled: true,
        members: { some: { userId, role: 'ADMIN' } },
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
    const csrfToken = jwt.sign(
      { typ: 'oauth-consent', sub: userId, digest: requestDigest(request) },
      process.env.AUTH_SECRET,
      { algorithm: 'HS256', expiresIn: CONSENT_TTL_SECONDS }
    );
    const redirect = new URL(request.redirectUri);
    return {
      client: { name: client.name, clientId: client.clientId },
      redirectHost: redirect.host,
      loopback: redirect.protocol === 'http:',
      scopes: request.scopes.map((scope) => ({ scope, description: OAUTH_SCOPES[scope] })),
      organizations,
      csrfToken,
      denyUrl: (() => {
        const url = new URL(request.redirectUri);
        url.searchParams.set('error', 'access_denied');
        if (request.state) url.searchParams.set('state', request.state);
        url.searchParams.set('iss', oauthIssuer());
        return url.toString();
      })(),
    };
  }

  async approve(userId, input) {
    const { request, client } = await this.normalizeAuthorizationRequest(input);
    let proof;
    try {
      proof = jwt.verify(input?.csrf_token, process.env.AUTH_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new OAuthProtocolError('invalid_request', 'The consent request expired; start again');
    }
    if (proof.typ !== 'oauth-consent' || proof.sub !== userId || proof.digest !== requestDigest(request)) {
      throw new OAuthProtocolError('invalid_request', 'The consent request is invalid');
    }
    const organizationId = input?.organization_id;
    if (typeof organizationId !== 'string' || !organizationId) throw new OAuthProtocolError('invalid_request', 'Choose one store');
    await assertGrantAllowed(userId, organizationId);

    const code = tokenValue('code');
    await prisma.$transaction(async (tx) => {
      const grant = await tx.oAuthGrant.upsert({
        where: { userId_organizationId_clientId: { userId, organizationId, clientId: client.clientId } },
        update: { scopes: request.scopes, revokedAt: null, revokedReason: null },
        create: { userId, organizationId, clientId: client.clientId, scopes: request.scopes },
      });
      // Re-consent never revives tokens from an earlier/revoked grant.
      await tx.oAuthToken.deleteMany({ where: { grantId: grant.id } });
      // The grant is mutable because its uniqueness is user + org + client.
      // Invalidate older unused codes so none can inherit a later scope set.
      await tx.oAuthAuthCode.deleteMany({
        where: { userId, organizationId, clientId: client.clientId },
      });
      await tx.oAuthAuthCode.create({
        data: {
          codeHash: sha256(code),
          codeChallenge: request.codeChallenge,
          redirectUri: request.redirectUri,
          userId,
          organizationId,
          clientId: client.clientId,
          scopes: request.scopes,
          resource: request.resource,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      });
    });
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set('code', code);
    if (request.state) redirect.searchParams.set('state', request.state);
    redirect.searchParams.set('iss', oauthIssuer());
    return redirect.toString();
  }

  async _issue(grant, audience, familyId = randomBytes(16).toString('base64url'), absoluteStart = new Date(), db = prisma) {
    const now = new Date();
    const absoluteExpiry = absoluteStart.getTime() + REFRESH_ABSOLUTE_MS;
    const refreshExpiry = new Date(Math.min(now.getTime() + REFRESH_IDLE_MS, absoluteExpiry));
    if (refreshExpiry <= now) throw invalidGrant();
    const accessToken = tokenValue('at');
    const refreshToken = tokenValue('rt');
    const accessHash = hashOAuthToken(accessToken);
    const refreshHash = hashOAuthToken(refreshToken);
    if (!accessHash || !refreshHash) throw new OAuthProtocolError('server_error', 'OAuth token storage is not configured', 500);
    await db.oAuthToken.createMany({ data: [
      {
        grantId: grant.id,
        kind: 'ACCESS',
        tokenHash: accessHash,
        audience,
        familyId,
        expiresAt: new Date(now.getTime() + ACCESS_TTL_SECONDS * 1000),
      },
      {
        grantId: grant.id,
        kind: 'REFRESH',
        tokenHash: refreshHash,
        audience,
        familyId,
        expiresAt: refreshExpiry,
      },
    ] });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: grant.scopes.join(' '),
    };
  }

  async exchangeCode(input) {
    const code = input?.code;
    if (typeof code !== 'string' || !code) throw invalidGrant();
    const now = new Date();
    const claimed = await prisma.oAuthAuthCode.updateMany({
      where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw invalidGrant();
    const row = await prisma.oAuthAuthCode.findUnique({
      where: { codeHash: sha256(code) },
      include: { client: true },
    });
    if (
      !row || input?.client_id !== row.clientId || input?.redirect_uri !== row.redirectUri ||
      input?.resource !== row.resource || !pkceMatches(input?.code_verifier, row.codeChallenge)
    ) throw invalidGrant();
    await assertGrantAllowed(row.userId, row.organizationId);
    const grant = await prisma.oAuthGrant.findUnique({
      where: { userId_organizationId_clientId: { userId: row.userId, organizationId: row.organizationId, clientId: row.clientId } },
    });
    if (!grant || grant.revokedAt) throw invalidGrant();
    return this._issue(grant, row.resource);
  }

  async exchangeRefresh(input) {
    const raw = input?.refresh_token;
    const tokenHash = hashOAuthToken(raw);
    if (!tokenHash) throw invalidGrant();
    const row = await prisma.oAuthToken.findUnique({
      where: { tokenHash },
      include: { grant: true },
    });
    if (!row || row.kind !== 'REFRESH') throw invalidGrant();
    if (
      input?.client_id !== row.grant.clientId || input?.resource !== row.audience || row.grant.revokedAt
    ) throw invalidGrant();
    await assertGrantAllowed(row.grant.userId, row.grant.organizationId);
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.oAuthToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        const current = await tx.oAuthToken.findUnique({ where: { id: row.id }, select: { usedAt: true } });
        if (current?.usedAt) {
          await tx.oAuthGrant.updateMany({
            where: { id: row.grantId, revokedAt: null },
            data: { revokedAt: now, revokedReason: 'refresh_reuse' },
          });
          return { reuse: true };
        }
        return { invalid: true };
      }
      const familyStart = await tx.oAuthToken.findFirst({
        where: { grantId: row.grantId, familyId: row.familyId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      return {
        tokens: await this._issue(
          row.grant,
          row.audience,
          row.familyId,
          familyStart?.createdAt ?? row.createdAt,
          tx
        ),
      };
    });
    if (!result.tokens) throw invalidGrant();
    return result.tokens;
  }

  async token(input) {
    if (input?.grant_type === 'authorization_code') return this.exchangeCode(input);
    if (input?.grant_type === 'refresh_token') return this.exchangeRefresh(input);
    throw new OAuthProtocolError('unsupported_grant_type', 'The grant type is not supported');
  }

  async revoke(input) {
    const tokenHash = hashOAuthToken(input?.token);
    if (!tokenHash) return;
    const row = await prisma.oAuthToken.findUnique({ where: { tokenHash }, include: { grant: true } });
    if (!row || (input?.client_id && input.client_id !== row.grant.clientId)) return;
    if (row.kind === 'REFRESH') {
      await prisma.oAuthGrant.updateMany({
        where: { id: row.grantId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'user' },
      });
    } else {
      await prisma.oAuthToken.delete({ where: { id: row.id } });
    }
  }
}

export default new OAuthService();
