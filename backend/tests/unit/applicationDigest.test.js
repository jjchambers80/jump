// Unit tests for ApplicationDigestService.sendDue (spec 011 phase 3)
// Mocks @jump/db and never hits a real database.
//
// The behaviour under guard is the sweep's blast radius. Sending a digest
// SPENDS the organization's window (the conditional updateMany claim), so an
// unscoped sweep does not merely read other organizations — it consumes them.
// The contract suites share one jump_test database, so a suite that sweeps
// unscoped silently breaks a concurrent suite's digest assertions.

import { jest } from '@jest/globals';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockSendApplicationMessage = jest.fn();

// A tiny two-organization store. `organization.findMany` honours the id scope
// and the due predicate; `updateMany` honours the compare-and-set claim, which
// is the write the scope is there to contain.
let orgs;

function orgFindMany({ where }) {
  const due = (o) =>
    o.applicationDigestEnabled &&
    o.status === 'ACTIVE' &&
    (o.applicationDigestAt === null || o.applicationDigestAt <= where.OR[1].applicationDigestAt.lte);
  return Promise.resolve(
    orgs
      .filter((o) => (where.id ? o.id === where.id : true))
      .filter(due)
      .map(({ id, name, logoUrl, applicationDigestAt }) => ({ id, name, logoUrl, applicationDigestAt }))
  );
}

function orgUpdateMany({ where, data }) {
  const row = orgs.find((o) => o.id === where.id);
  const held = row?.applicationDigestAt ?? null;
  if (!row || held?.getTime?.() !== where.applicationDigestAt?.getTime?.()) {
    if (!(held === null && where.applicationDigestAt === null)) return Promise.resolve({ count: 0 });
  }
  row.applicationDigestAt = data.applicationDigestAt;
  return Promise.resolve({ count: 1 });
}

const mockApplicationFindMany = jest.fn();
const mockOrgFindMany = jest.fn(orgFindMany);

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    organization: { findMany: mockOrgFindMany, updateMany: jest.fn(orgUpdateMany) },
    application: { findMany: mockApplicationFindMany, count: jest.fn(async () => 0) },
    organizationMember: {
      findMany: jest.fn(async () => [{ user: { email: 'staff@example.test' } }]),
    },
  },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({ default: logger }));
jest.unstable_mockModule('../../src/services/EmailService.js', () => ({
  default: { sendApplicationMessage: mockSendApplicationMessage },
}));
jest.unstable_mockModule('../../src/utils/storefrontUrl.js', () => ({
  platformBaseUrl: () => 'https://jump.test',
}));

/** One submitted application, shaped like the service's include. */
function submission(orgId) {
  return {
    event: { id: `evt_${orgId}`, name: `Event ${orgId}` },
    form: { id: `form_${orgId}`, name: 'Vendor Booth', kind: 'FREE' },
    tier: { name: 'Booth' },
    profile: { businessName: `Business ${orgId}` },
    contact: { firstName: 'Vee', lastName: 'Vendor' },
    order: null,
  };
}

describe('ApplicationDigestService.sendDue', () => {
  let service;

  beforeAll(async () => {
    service = (await import('../../src/services/ApplicationDigestService.js')).default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrgFindMany.mockImplementation(orgFindMany);
    orgs = [
      { id: 'org_a', name: 'Org A', logoUrl: null, status: 'ACTIVE', applicationDigestEnabled: true, applicationDigestAt: null },
      { id: 'org_b', name: 'Org B', logoUrl: null, status: 'ACTIVE', applicationDigestEnabled: true, applicationDigestAt: null },
    ];
    mockApplicationFindMany.mockImplementation(async ({ where }) => [submission(where.organizationId)]);
    mockSendApplicationMessage.mockResolvedValue();
  });

  it('sweeps every due organization when unscoped', async () => {
    const result = await service.sendDue(new Date());

    expect(result).toEqual({ organizations: 2, sent: 2 });
    expect(mockOrgFindMany.mock.calls[0][0].where.id).toBeUndefined();
    expect(orgs.every((o) => o.applicationDigestAt !== null)).toBe(true);
  });

  it('touches only the scoped organization, leaving another suite window unspent', async () => {
    const now = new Date();
    const result = await service.sendDue(now, { organizationId: 'org_a' });

    expect(result).toEqual({ organizations: 1, sent: 1 });
    expect(mockOrgFindMany.mock.calls[0][0].where.id).toBe('org_a');
    expect(mockSendApplicationMessage.mock.calls.map(([m]) => m.subject)).toEqual(['1 new application — Org A']);
    // The crux: org_b's window is still unclaimed, so its own suite can send it.
    expect(orgs.find((o) => o.id === 'org_b').applicationDigestAt).toBeNull();

    expect(await service.sendDue(now, { organizationId: 'org_b' })).toEqual({ organizations: 1, sent: 1 });
  });

  it('a claimed window is not sent twice', async () => {
    const now = new Date();
    await service.sendDue(now, { organizationId: 'org_a' });
    mockSendApplicationMessage.mockClear();

    // Same window: the org is no longer due, so nothing is selected or sent.
    expect(await service.sendDue(now, { organizationId: 'org_a' })).toEqual({ organizations: 0, sent: 0 });
    expect(mockSendApplicationMessage).not.toHaveBeenCalled();
  });

  it('advances the window even when the scope has no submissions', async () => {
    mockApplicationFindMany.mockResolvedValue([]);

    expect(await service.sendDue(new Date(), { organizationId: 'org_a' })).toEqual({ organizations: 1, sent: 0 });
    expect(mockSendApplicationMessage).not.toHaveBeenCalled();
    expect(orgs.find((o) => o.id === 'org_a').applicationDigestAt).not.toBeNull();
  });
});
