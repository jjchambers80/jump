import { createHmac } from 'node:crypto';
import { jest } from '@jest/globals';

const prisma = {
  platformSetting: { findUnique: jest.fn() },
  oAuthToken: { findUnique: jest.fn() },
  organizationMember: { findUnique: jest.fn() },
  oAuthGrant: { update: jest.fn(), updateMany: jest.fn() },
};
const cacheIncrement = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({ prisma }));
jest.unstable_mockModule('../../src/utils/cache.js', () => ({ cacheIncrement }));

const {
  AGENT_RESOURCE,
  default: service,
  hashOAuthToken,
} = await import('../../src/services/AgentAuthService.js');

const RAW_TOKEN = 'oauth_secret_bearer_value';
const PEPPER = 'test-oauth-pepper';

function tokenRow(overrides = {}) {
  const { grant: grantOverrides = {}, ...rowOverrides } = overrides;
  const grant = {
    id: 'grant_1',
    userId: 'user_1',
    organizationId: 'org_1',
    scopes: ['store:read'],
    revokedAt: null,
    client: { name: 'Claude' },
    organization: { agentAccessEnabled: true },
    user: { isActive: true, deletedAt: null },
    ...grantOverrides,
  };
  return {
    id: 'token_1',
    kind: 'ACCESS',
    audience: AGENT_RESOURCE,
    expiresAt: new Date(Date.now() + 60_000),
    grant,
    ...rowOverrides,
  };
}

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('AgentAuthService.agentAuthorize', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_ACCESS_ENABLED = 'true';
    process.env.OAUTH_TOKEN_PEPPER = PEPPER;
    delete process.env.RATE_LIMIT_AGENT_GRANT_LIMIT;
    delete process.env.RATE_LIMIT_AGENT_ORG_LIMIT;
    prisma.platformSetting.findUnique.mockResolvedValue({ value: true });
    prisma.oAuthToken.findUnique.mockResolvedValue(tokenRow());
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.oAuthGrant.update.mockResolvedValue({});
    prisma.oAuthGrant.updateMany.mockResolvedValue({ count: 1 });
    cacheIncrement.mockResolvedValue(1);
  });

  afterAll(() => {
    delete process.env.AGENT_ACCESS_ENABLED;
    delete process.env.OAUTH_TOKEN_PEPPER;
    delete process.env.RATE_LIMIT_AGENT_GRANT_LIMIT;
    delete process.env.RATE_LIMIT_AGENT_ORG_LIMIT;
  });

  it('returns only the authorization identity for a valid token', async () => {
    await expect(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' })).resolves.toEqual({
      userId: 'user_1',
      organizationId: 'org_1',
      grantId: 'grant_1',
      clientName: 'Claude',
      scopes: ['store:read'],
      expiresAt: expect.any(Date),
    });
  });

  it('checks the env switch on the very next call', async () => {
    await service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' });
    process.env.AGENT_ACCESS_ENABLED = 'false';
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'agent_access_disabled');
    expect(prisma.oAuthToken.findUnique).toHaveBeenCalledTimes(1);
  });

  it('checks the global switch on the very next call', async () => {
    await service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' });
    prisma.platformSetting.findUnique.mockResolvedValue({ value: false });
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'agent_access_disabled');
  });

  it('checks the organization switch on the very next call', async () => {
    await service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' });
    prisma.oAuthToken.findUnique.mockResolvedValue(tokenRow({ grant: { organization: { agentAccessEnabled: false } } }));
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'agent_access_disabled');
  });

  it.each([
    ['expired', () => tokenRow({ expiresAt: new Date(Date.now() - 1) })],
    ['wrong audience', () => tokenRow({ audience: 'https://api.eventimus.net' })],
    ['revoked grant', () => tokenRow({ grant: { revokedAt: new Date() } })],
    ['refresh token', () => tokenRow({ kind: 'REFRESH' })],
  ])('denies an %s token', async (_label, makeRow) => {
    prisma.oAuthToken.findUnique.mockResolvedValue(makeRow());
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'invalid_token');
  });

  it.each([
    ['removed', null],
    ['demoted to ORGANIZER', { role: 'ORGANIZER' }],
  ])('denies and revokes when the member was %s', async (_label, membership) => {
    prisma.organizationMember.findUnique.mockResolvedValue(membership);
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'invalid_token');
    expect(prisma.oAuthGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'grant_1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'member_removed' },
    });
  });

  it('revokes when the user is inactive without querying membership', async () => {
    prisma.oAuthToken.findUnique.mockResolvedValue(tokenRow({ grant: { user: { isActive: false, deletedAt: null } } }));
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'invalid_token');
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.oAuthGrant.updateMany).toHaveBeenCalled();
  });

  it('returns insufficient_scope for a missing scope', async () => {
    await expect(service.agentAuthorize(RAW_TOKEN, { scope: 'events:write' })).rejects.toMatchObject({
      code: 'insufficient_scope',
      requiredScopes: ['events:write'],
    });
    expect(cacheIncrement).not.toHaveBeenCalled();
  });

  it('fails closed when a tool forgets to declare its required scope', async () => {
    await expectCode(service.agentAuthorize(RAW_TOKEN), 'insufficient_scope');
    expect(cacheIncrement).not.toHaveBeenCalled();
  });

  it('trips the fixed-window limit per grant', async () => {
    process.env.RATE_LIMIT_AGENT_GRANT_LIMIT = '2';
    const counters = new Map();
    cacheIncrement.mockImplementation(async (key) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    });
    await service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' });
    await service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' });
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'rate_limited');
    expect(cacheIncrement).toHaveBeenLastCalledWith('agent-limit:agent_grant:grant_1', 60_000);
  });

  it('applies a separate per-organization ceiling', async () => {
    process.env.RATE_LIMIT_AGENT_ORG_LIMIT = '1';
    cacheIncrement
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    await service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' });
    await expectCode(service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' }), 'rate_limited');
  });

  it('queries only by the HMAC and never sends the plaintext token to Prisma', async () => {
    await service.agentAuthorize(RAW_TOKEN, { scope: 'store:read' });
    const expected = createHmac('sha256', PEPPER).update(RAW_TOKEN).digest('hex');
    expect(hashOAuthToken(RAW_TOKEN)).toBe(expected);
    expect(prisma.oAuthToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: expected } }));
    expect(JSON.stringify(prisma.oAuthToken.findUnique.mock.calls)).not.toContain(RAW_TOKEN);
  });
});
