import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { prisma } from '@jump/db';
import app from '../../src/api/server.js';
import agentAuthService, { AGENT_RESOURCE } from '../../src/services/AgentAuthService.js';
import { issueReauthProof } from '../../src/middleware/recentAuth.js';
import { cleanupStaff, joinOrgByToken, staffToken } from '../helpers/staff.js';

const EMAIL = 'oauth-contract-admin@example.com';
const ORGANIZER_EMAIL = 'oauth-contract-organizer@example.com';
const VERIFIER = 'oauth-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDE';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const REDIRECT = 'http://127.0.0.1:47891/callback';
let adminToken;
let organizerToken;
let adminId;
let organizerId;
let organization;
let oldEnabled;
let oldPepper;
let oldPlatformSetting;

const authRequest = (overrides = {}) => ({
  response_type: 'code',
  client_id: 'jump-cli',
  redirect_uri: REDIRECT,
  scope: 'store:read',
  state: 'state-value',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  resource: AGENT_RESOURCE,
  ...overrides,
});

async function consent(token = adminToken, payload = authRequest(), organizationId = organization.id) {
  const prepared = await request(app)
    .post('/oauth/authorize/prepare')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
  expect(prepared.status).toBe(200);
  const userId = token === organizerToken ? organizerId : adminId;
  const reauth = issueReauthProof(userId).reauthToken;
  return request(app)
    .post('/oauth/authorize')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Jump-Reauth', reauth)
    .send({ ...payload, organization_id: organizationId, csrf_token: prepared.body.csrfToken });
}

function codeFrom(response) {
  expect(response.status).toBe(200);
  const redirect = new URL(response.body.redirect_to);
  expect([...redirect.searchParams.keys()].sort()).toEqual(['code', 'iss', 'state']);
  return redirect.searchParams.get('code');
}

async function exchange(code, overrides = {}) {
  return request(app)
    .post('/oauth/token')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: 'jump-cli',
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
      resource: AGENT_RESOURCE,
      ...overrides,
    });
}

beforeAll(async () => {
  oldEnabled = process.env.AGENT_ACCESS_ENABLED;
  oldPepper = process.env.OAUTH_TOKEN_PEPPER;
  process.env.AGENT_ACCESS_ENABLED = 'true';
  process.env.OAUTH_TOKEN_PEPPER = 'oauth-contract-pepper';
  oldPlatformSetting = await prisma.platformSetting.findUnique({ where: { key: 'agentAccessEnabled' } });
  organization = await prisma.organization.create({
    data: { name: 'OAuth Contract Store', agentAccessEnabled: true },
  });
  adminToken = await staffToken({ email: EMAIL, role: 'ADMIN', name: 'OAuth Admin' });
  organizerToken = await staffToken({ email: ORGANIZER_EMAIL, role: 'ORGANIZER', name: 'OAuth Organizer' });
  adminId = (await prisma.user.findUnique({ where: { email: EMAIL } })).id;
  organizerId = (await prisma.user.findUnique({ where: { email: ORGANIZER_EMAIL } })).id;
  await joinOrgByToken(adminToken, organization.id, 'ADMIN');
  await joinOrgByToken(organizerToken, organization.id, 'ORGANIZER');
  await prisma.platformSetting.upsert({
    where: { key: 'agentAccessEnabled' },
    update: { value: true },
    create: { key: 'agentAccessEnabled', value: true },
  });
});

beforeEach(async () => {
  process.env.AGENT_ACCESS_ENABLED = 'true';
  await prisma.platformSetting.upsert({
    where: { key: 'agentAccessEnabled' },
    update: { value: true },
    create: { key: 'agentAccessEnabled', value: true },
  });
  await prisma.organization.update({ where: { id: organization.id }, data: { agentAccessEnabled: true } });
  await prisma.oAuthAuthCode.deleteMany({ where: { organizationId: organization.id } });
  await prisma.oAuthGrant.deleteMany({ where: { organizationId: organization.id } });
});

afterAll(async () => {
  await prisma.oAuthAuthCode.deleteMany({ where: { organizationId: organization.id } });
  await prisma.oAuthGrant.deleteMany({ where: { organizationId: organization.id } });
  await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {});
  await cleanupStaff([EMAIL, ORGANIZER_EMAIL]);
  if (oldPlatformSetting) {
    await prisma.platformSetting.update({
      where: { key: 'agentAccessEnabled' },
      data: { value: oldPlatformSetting.value, updatedBy: oldPlatformSetting.updatedBy },
    });
  } else {
    await prisma.platformSetting.delete({ where: { key: 'agentAccessEnabled' } }).catch(() => {});
  }
  if (oldEnabled === undefined) delete process.env.AGENT_ACCESS_ENABLED;
  else process.env.AGENT_ACCESS_ENABLED = oldEnabled;
  if (oldPepper === undefined) delete process.env.OAUTH_TOKEN_PEPPER;
  else process.env.OAUTH_TOKEN_PEPPER = oldPepper;
});

describe('OAuth authorization server', () => {
  it('publishes OAuth and protected-resource metadata', async () => {
    const metadata = await request(app).get('/.well-known/oauth-authorization-server');
    expect(metadata.status).toBe(200);
    expect(metadata.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.body.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(metadata.body.client_id_metadata_document_supported).toBe(true);

    const resource = await request(app).get('/.well-known/oauth-protected-resource');
    expect(resource.status).toBe(200);
    expect(resource.body.resource).toBe(AGENT_RESOURCE);
  });

  it('is undiscoverable while the environment gate is off', async () => {
    process.env.AGENT_ACCESS_ENABLED = 'false';
    expect((await request(app).get('/.well-known/oauth-authorization-server')).status).toBe(404);
    expect((await request(app).post('/oauth/token').type('form').send({})).status).toBe(404);
  });

  it('registers a public DCR client with exact redirects', async () => {
    const response = await request(app).post('/oauth/register').send({
      client_name: 'Contract client',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
    });
    expect(response.status).toBe(201);
    expect(response.body.client_id).toMatch(/^jmp_client_/);
    expect(response.body.redirect_uris).toEqual(['https://client.example/callback']);
    const client = await prisma.oAuthClient.findUnique({ where: { clientId: response.body.client_id } });
    expect(client.kind).toBe('DCR');
    await prisma.oAuthClient.delete({ where: { clientId: response.body.client_id } });
  });

  it('refuses PKCE failure and burns the code', async () => {
    const code = codeFrom(await consent());
    const failed = await exchange(code, { code_verifier: 'x'.repeat(43) });
    expect(failed.status).toBe(400);
    expect(failed.body.error).toBe('invalid_grant');
    expect((await exchange(code)).body.error).toBe('invalid_grant');
  });

  it('refuses an unregistered redirect URI before consent', async () => {
    const response = await request(app).get('/oauth/authorize').query(authRequest({
      redirect_uri: 'https://evil.example/callback',
    }));
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
  });

  it('returns redirect-safe authorization errors with state and issuer', async () => {
    const response = await request(app).get('/oauth/authorize').query(authRequest({ scope: 'unknown' }));
    expect(response.status).toBe(302);
    const target = new URL(response.headers.location);
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get('error')).toBe('invalid_scope');
    expect(target.searchParams.get('state')).toBe('state-value');
    expect(target.searchParams.get('iss')).toBeTruthy();
  });

  it('issues audience-bound access and refresh tokens without putting tokens in redirect URLs', async () => {
    const code = codeFrom(await consent());
    const response = await exchange(code);
    expect(response.status).toBe(200);
    expect(response.body.access_token).toMatch(/^jmp_at_/);
    expect(response.body.refresh_token).toMatch(/^jmp_rt_/);
    await expect(agentAuthService.agentAuthorize(response.body.access_token, {
      scope: 'store:read',
      audience: AGENT_RESOURCE,
    })).resolves.toMatchObject({ organizationId: organization.id, userId: adminId });
    await expect(agentAuthService.agentAuthorize(response.body.access_token, {
      scope: 'store:read',
      audience: 'https://api.eventimus.net',
    })).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('refuses exchanging an authorization code for another resource', async () => {
    const code = codeFrom(await consent());
    const response = await exchange(code, { resource: 'https://api.eventimus.net' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_grant');
  });

  it('rotates refresh tokens and revokes the grant when one is reused', async () => {
    const issued = await exchange(codeFrom(await consent()));
    const oldRefresh = issued.body.refresh_token;
    const rotated = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      client_id: 'jump-cli',
      refresh_token: oldRefresh,
      resource: AGENT_RESOURCE,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(oldRefresh);

    const reused = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      client_id: 'jump-cli',
      refresh_token: oldRefresh,
      resource: AGENT_RESOURCE,
    });
    expect(reused.status).toBe(400);
    expect(reused.body.error).toBe('invalid_grant');
    const grant = await prisma.oAuthGrant.findFirst({ where: { organizationId: organization.id } });
    expect(grant.revokedReason).toBe('refresh_reuse');
    await expect(agentAuthService.agentAuthorize(rotated.body.access_token, {
      scope: 'store:read', audience: AGENT_RESOURCE,
    })).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('revokes the grant when concurrent refresh requests race', async () => {
    const issued = await exchange(codeFrom(await consent()));
    const payload = {
      grant_type: 'refresh_token',
      client_id: 'jump-cli',
      refresh_token: issued.body.refresh_token,
      resource: AGENT_RESOURCE,
    };
    const [a, b] = await Promise.all([
      request(app).post('/oauth/token').type('form').send(payload),
      request(app).post('/oauth/token').type('form').send(payload),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const grant = await prisma.oAuthGrant.findFirst({ where: { organizationId: organization.id } });
    expect(grant.revokedReason).toBe('refresh_reuse');
  });

  it('reuses the unique grant on re-consent without reviving old tokens', async () => {
    const first = await exchange(codeFrom(await consent()));
    const originalGrant = await prisma.oAuthGrant.findFirst({ where: { organizationId: organization.id } });
    const second = await exchange(codeFrom(await consent()));
    const grants = await prisma.oAuthGrant.findMany({ where: { organizationId: organization.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0].id).toBe(originalGrant.id);
    await expect(agentAuthService.agentAuthorize(first.body.access_token, {
      scope: 'store:read', audience: AGENT_RESOURCE,
    })).rejects.toMatchObject({ code: 'invalid_token' });
    await expect(agentAuthService.agentAuthorize(second.body.access_token, {
      scope: 'store:read', audience: AGENT_RESOURCE,
    })).resolves.toMatchObject({ organizationId: organization.id });
  });

  it('revokes refresh-token grants through RFC 7009', async () => {
    const issued = await exchange(codeFrom(await consent()));
    const revoked = await request(app).post('/oauth/revoke').type('form').send({
      token: issued.body.refresh_token,
      client_id: 'jump-cli',
    });
    expect(revoked.status).toBe(200);
    await expect(agentAuthService.agentAuthorize(issued.body.access_token, {
      scope: 'store:read', audience: AGENT_RESOURCE,
    })).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('does not offer an ORGANIZER membership and refuses direct consent', async () => {
    const prepared = await request(app)
      .post('/oauth/authorize/prepare')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send(authRequest());
    expect(prepared.status).toBe(200);
    expect(prepared.body.organizations).toEqual([]);
    const response = await request(app)
      .post('/oauth/authorize')
      .set('Authorization', `Bearer ${organizerToken}`)
      .set('X-Jump-Reauth', issueReauthProof(organizerId).reauthToken)
      .send({
        ...authRequest(),
        organization_id: organization.id,
        csrf_token: prepared.body.csrfToken,
      });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('access_denied');
  });

  it('refuses consent when the store or global switch is off', async () => {
    await prisma.organization.update({ where: { id: organization.id }, data: { agentAccessEnabled: false } });
    const orgOff = await request(app)
      .post('/oauth/authorize/prepare')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(authRequest());
    expect(orgOff.status).toBe(200);
    expect(orgOff.body.organizations).toEqual([]);

    await prisma.platformSetting.update({ where: { key: 'agentAccessEnabled' }, data: { value: false } });
    const globalOff = await request(app)
      .post('/oauth/authorize/prepare')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(authRequest());
    expect(globalOff.status).toBe(403);
    expect(globalOff.body.error).toBe('access_denied');
  });

  it('re-checks switches at the token endpoint', async () => {
    const code = codeFrom(await consent());
    await prisma.organization.update({ where: { id: organization.id }, data: { agentAccessEnabled: false } });
    const response = await exchange(code);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('access_denied');
  });
});
