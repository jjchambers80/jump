// Unit tests for ConnectService (spec 010 phase 2)
// Account-object mapping, lifecycle status, the destination-charge routing
// rule, onboarding/link calls and payout-settings validation — Prisma and
// Stripe mocked.

import { jest } from '@jest/globals';

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockOrgFindUnique = jest.fn();
const mockAccountsCreate = jest.fn();
const mockAccountsRetrieve = jest.fn();
const mockAccountsUpdate = jest.fn();
const mockCreateLoginLink = jest.fn();
const mockAccountLinksCreate = jest.fn();
const mockBalanceRetrieve = jest.fn();
const mockPayoutsList = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    organizationStripeAccount: { findUnique: mockFindUnique, create: mockCreate, update: mockUpdate, delete: mockDelete },
    organization: { findUnique: mockOrgFindUnique },
  },
}));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: {
    accounts: {
      create: mockAccountsCreate,
      retrieve: mockAccountsRetrieve,
      update: mockAccountsUpdate,
      createLoginLink: mockCreateLoginLink,
    },
    accountLinks: { create: mockAccountLinksCreate },
    balance: { retrieve: mockBalanceRetrieve },
    payouts: { list: mockPayoutsList },
  },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../src/utils/storefrontUrl.js', () => ({
  platformBaseUrl: () => process.env.TEST_BASE_URL || 'http://localhost:3001',
  orgPageUrl: async (id) => `https://tickets.example.com/organizations/${id}`,
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_unit';

const { default: service, accountToRow, connectStatus, connectEnabled, serializePayout } = await import('../../src/services/ConnectService.js');

const stripeAccount = (over = {}) => ({
  id: 'acct_1',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  default_currency: 'usd',
  capabilities: { card_payments: 'active', transfers: 'active' },
  requirements: { disabled_reason: null, currently_due: [] },
  external_accounts: { data: [{ object: 'bank_account', bank_name: 'Wells Fargo', last4: '3544', currency: 'usd', default_for_currency: true }] },
  settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'friday', delay_days: 2 }, statement_descriptor: 'ROMAN SKIN' } },
  ...over,
});

const row = (over = {}) => ({
  id: 'osa_1',
  organizationId: 'org_1',
  mode: 'test',
  stripeAccountId: 'acct_1',
  chargesEnabled: true,
  transfersEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  disabledReason: null,
  currentlyDue: [],
  bankName: 'Wells Fargo',
  bankLast4: '3544',
  currency: 'usd',
  payoutInterval: 'weekly',
  payoutAnchor: 'friday',
  payoutDelayDays: 2,
  payoutDescriptor: 'ROMAN SKIN',
  lastPayoutAt: null,
  lastPayoutFailure: null,
  disconnectedAt: null,
  lastSyncedAt: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STRIPE_CONNECT_ENABLED = 'true';
  delete process.env.TEST_BASE_URL;
  mockUpdate.mockImplementation(({ data }) => Promise.resolve(row(data)));
  mockCreate.mockImplementation(({ data }) => Promise.resolve(row(data)));
});

describe('accountToRow', () => {
  test('maps an active account with a default bank and weekly schedule', () => {
    expect(accountToRow(stripeAccount())).toMatchObject({
      chargesEnabled: true,
      transfersEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      disabledReason: null,
      currentlyDue: [],
      bankName: 'Wells Fargo',
      bankLast4: '3544',
      currency: 'usd',
      payoutInterval: 'weekly',
      payoutAnchor: 'friday',
      payoutDelayDays: 2,
      payoutDescriptor: 'ROMAN SKIN',
      lastSyncedAt: expect.any(Date),
    });
  });

  test('maps a fresh account with nothing submitted and a monthly anchor as a string', () => {
    const mapped = accountToRow(
      stripeAccount({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        capabilities: { transfers: 'pending' },
        requirements: { disabled_reason: 'requirements.past_due', currently_due: ['individual.ssn_last_4'] },
        external_accounts: { data: [] },
        settings: { payouts: { schedule: { interval: 'monthly', monthly_anchor: 15 } } },
      })
    );
    expect(mapped).toMatchObject({
      transfersEnabled: false,
      detailsSubmitted: false,
      disabledReason: 'requirements.past_due',
      currentlyDue: ['individual.ssn_last_4'],
      bankName: null,
      bankLast4: null,
      currency: 'usd',
      payoutInterval: 'monthly',
      payoutAnchor: '15',
      payoutDescriptor: null,
    });
  });
});

describe('connectStatus', () => {
  test.each([
    ['not_started', null],
    ['onboarding', row({ detailsSubmitted: false, transfersEnabled: false })],
    ['restricted', row({ transfersEnabled: false })],
    ['restricted', row({ disabledReason: 'requirements.past_due' })],
    ['restricted', row({ currentlyDue: ['external_account'] })],
    ['active', row()],
    ['disconnected', row({ disconnectedAt: new Date() })],
  ])('%s', (expected, input) => {
    expect(connectStatus(input)).toBe(expected);
  });
});

describe('destinationFor (routing rule)', () => {
  test('routes to the account when the flag is on and transfers are active', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    expect(await service.destinationFor('org_1')).toEqual({ stripeAccountId: 'acct_1' });
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { organizationId_mode: { organizationId: 'org_1', mode: 'test' } } });
  });

  test('platform account when the flag is off (no DB read)', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'false';
    expect(connectEnabled()).toBe(false);
    expect(await service.destinationFor('org_1')).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('platform account when there is no row for this mode, transfers are inactive, or disconnected', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await service.destinationFor('org_1')).toBeNull();
    mockFindUnique.mockResolvedValueOnce(row({ transfersEnabled: false }));
    expect(await service.destinationFor('org_1')).toBeNull();
    mockFindUnique.mockResolvedValueOnce(row({ disconnectedAt: new Date() }));
    expect(await service.destinationFor('org_1')).toBeNull();
  });

  test('payouts being paused does not block routing', async () => {
    mockFindUnique.mockResolvedValueOnce(row({ payoutsEnabled: false }));
    expect(await service.destinationFor('org_1')).toEqual({ stripeAccountId: 'acct_1' });
  });

  test('never throws: a DB failure charges on the platform account', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('db down'));
    expect(await service.destinationFor('org_1')).toBeNull();
  });
});

describe('statusFor', () => {
  test('disabled payload when the flag is off', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'false';
    expect(await service.statusFor('org_1')).toEqual({ enabled: false, status: 'not_started', account: null });
  });

  test('serializes the row with bank and payout snapshot', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    const state = await service.statusFor('org_1');
    expect(state.enabled).toBe(true);
    expect(state.status).toBe('active');
    expect(state.account).toMatchObject({
      stripeAccountId: 'acct_1',
      status: 'active',
      bank: { name: 'Wells Fargo', last4: '3544', currency: 'usd' },
      payouts: { interval: 'weekly', anchor: 'friday', delayDays: 2, statementDescriptor: 'ROMAN SKIN' },
    });
  });
});

describe('startOnboarding', () => {
  const organization = { id: 'org_1', name: 'Roman Skin Care', email: 'owner@roman.test', phoneCountryCode: '+1', phoneNumber: '(919) 555-0100' };

  test('creates an Express account then mints an Account Link', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(organization);
    mockFindUnique.mockResolvedValueOnce(null);
    mockAccountsCreate.mockResolvedValueOnce(stripeAccount({ id: 'acct_new', details_submitted: false }));
    mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://connect.stripe.com/setup/e/acct_new/abc' });

    expect(await service.startOnboarding('org_1', { actorId: 'user_1' })).toEqual({ url: 'https://connect.stripe.com/setup/e/acct_new/abc' });

    const params = mockAccountsCreate.mock.calls[0][0];
    expect(params).toMatchObject({
      country: 'US',
      email: 'owner@roman.test',
      controller: {
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        stripe_dashboard: { type: 'express' },
        requirement_collection: 'stripe',
      },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { name: 'Roman Skin Care', support_phone: '+19195550100', url: 'https://tickets.example.com/organizations/org_1' },
      settings: { payouts: { statement_descriptor: 'ROMAN SKIN CARE' } },
      metadata: { organizationId: 'org_1', mode: 'test' },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org_1', mode: 'test', stripeAccountId: 'acct_new', detailsSubmitted: false }),
    });
    expect(mockAccountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_new',
      type: 'account_onboarding',
      return_url: 'http://localhost:3001/admin/settings/payments/payout-bank-account?onboarding=complete',
      refresh_url: 'http://localhost:3001/admin/settings/payments/payout-bank-account?onboarding=refresh',
    });
  });

  test('reuses an existing account and only mints a new link', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(organization);
    mockFindUnique.mockResolvedValueOnce(row({ detailsSubmitted: false }));
    mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://connect.stripe.com/setup/e/acct_1/xyz' });
    await service.startOnboarding('org_1');
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(expect.objectContaining({ account: 'acct_1' }));
  });

  test('a disconnected account is replaced by a fresh one', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(organization);
    mockFindUnique.mockResolvedValueOnce(row({ disconnectedAt: new Date() }));
    mockDelete.mockResolvedValueOnce({});
    mockAccountsCreate.mockResolvedValueOnce(stripeAccount({ id: 'acct_2', details_submitted: false }));
    mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://link' });
    await service.startOnboarding('org_1');
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'osa_1' } });
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
  });

  test('404 when the flag is off; 400 for a non-https base URL in live mode', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'false';
    await expect(service.startOnboarding('org_1')).rejects.toMatchObject({ statusCode: 404 });

    process.env.STRIPE_CONNECT_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_live_unit';
    await expect(service.startOnboarding('org_1')).rejects.toMatchObject({ statusCode: 400 });
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  });
});

describe('loginLink / syncAccount / applyAccount', () => {
  test('login link only after onboarding completed', async () => {
    mockFindUnique.mockResolvedValueOnce(row({ detailsSubmitted: false }));
    await expect(service.loginLink('org_1')).rejects.toMatchObject({ statusCode: 409 });

    mockFindUnique.mockResolvedValueOnce(row());
    mockCreateLoginLink.mockResolvedValueOnce({ url: 'https://connect.stripe.com/express/acct_1/login' });
    expect(await service.loginLink('org_1')).toEqual({ url: 'https://connect.stripe.com/express/acct_1/login' });
    expect(mockCreateLoginLink).toHaveBeenCalledWith('acct_1');
  });

  test('syncAccount retrieves with external accounts expanded and writes the mapping', async () => {
    mockFindUnique.mockResolvedValueOnce(row({ transfersEnabled: false, detailsSubmitted: false }));
    mockAccountsRetrieve.mockResolvedValueOnce(stripeAccount());
    mockFindUnique.mockResolvedValueOnce(row({ transfersEnabled: false, detailsSubmitted: false }));
    const state = await service.syncAccount('org_1');
    expect(mockAccountsRetrieve).toHaveBeenCalledWith('acct_1', { expand: ['external_accounts'] });
    expect(mockUpdate).toHaveBeenCalledWith({ where: { stripeAccountId: 'acct_1' }, data: expect.objectContaining({ transfersEnabled: true, detailsSubmitted: true }) });
    expect(state.status).toBe('active');
  });

  test('applyAccount ignores accounts Jump never created', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await service.applyAccount('acct_stranger', stripeAccount())).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('markDisconnected flips routing off', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    const state = await service.markDisconnected('acct_1');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { stripeAccountId: 'acct_1' },
      data: { disconnectedAt: expect.any(Date), transfersEnabled: false, chargesEnabled: false, payoutsEnabled: false },
    });
    expect(state.status).toBe('disconnected');
  });

  test('recordPayout stores the arrival date or the failure', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    await service.recordPayout('acct_1', { status: 'paid', arrival_date: 1_757_635_200 });
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { stripeAccountId: 'acct_1' },
      data: { lastPayoutAt: new Date(1_757_635_200 * 1000), lastPayoutFailure: null },
    });
    mockFindUnique.mockResolvedValueOnce(row());
    await service.recordPayout('acct_1', { status: 'failed', failure_code: 'account_closed', failure_message: 'The bank account has been closed' });
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { stripeAccountId: 'acct_1' },
      data: { lastPayoutFailure: 'The bank account has been closed' },
    });
  });
});

describe('updatePayoutSettings', () => {
  beforeEach(() => {
    mockAccountsUpdate.mockImplementation((id, params) =>
      Promise.resolve(stripeAccount({ settings: { payouts: { ...params.settings.payouts, schedule: params.settings.payouts.schedule || { interval: 'weekly', weekly_anchor: 'friday' } } } }))
    );
  });

  test.each([
    [{ interval: 'hourly' }, /daily, weekly or monthly/],
    [{ interval: 'daily', anchor: 'monday' }, /not allowed for daily/],
    [{ interval: 'weekly', anchor: 'someday' }, /weekday name/],
    [{ interval: 'monthly', anchor: 32 }, /day of month/],
    [{ interval: 'monthly', anchor: 0 }, /day of month/],
    [{ statementDescriptor: '' }, /required/],
    [{ statementDescriptor: 'ROMAN*SKIN' }, /letters, numbers and spaces/],
    [{ statementDescriptor: '2026' }, /at least one letter/],
    [{ statementDescriptor: 'ROMAN SKIN AND BODY COMPANY' }, /22 characters or fewer/],
    [{}, /Nothing to update/],
  ])('rejects %j', async (body, message) => {
    mockFindUnique.mockResolvedValueOnce(row());
    await expect(service.updatePayoutSettings('org_1', body)).rejects.toThrow(message);
    expect(mockAccountsUpdate).not.toHaveBeenCalled();
  });

  test('writes a monthly schedule and a normalized payout name, then re-syncs from the response', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    mockFindUnique.mockResolvedValueOnce(row());
    const state = await service.updatePayoutSettings('org_1', { interval: 'monthly', anchor: '15', statementDescriptor: ' roman skin ' });
    expect(mockAccountsUpdate).toHaveBeenCalledWith('acct_1', {
      settings: { payouts: { schedule: { interval: 'monthly', monthly_anchor: 15 }, statement_descriptor: 'ROMAN SKIN' } },
    });
    expect(state.payouts).toMatchObject({ interval: 'monthly', anchor: '15', statementDescriptor: 'ROMAN SKIN' });
  });

  test('daily schedule alone; refuses before onboarding completes', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    mockFindUnique.mockResolvedValueOnce(row());
    await service.updatePayoutSettings('org_1', { interval: 'daily' });
    expect(mockAccountsUpdate).toHaveBeenCalledWith('acct_1', { settings: { payouts: { schedule: { interval: 'daily' } } } });

    mockFindUnique.mockResolvedValueOnce(row({ detailsSubmitted: false }));
    await expect(service.updatePayoutSettings('org_1', { interval: 'daily' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('payoutActivity (Finance › Payouts)', () => {
  const stripePayout = (over = {}) => ({
    id: 'po_1',
    amount: 12345,
    currency: 'usd',
    status: 'paid',
    arrival_date: 1789516800, // 2026-09-16T00:00:00Z
    created: 1789344000,
    automatic: true,
    statement_descriptor: 'ROMAN SKIN',
    failure_message: null,
    destination: { object: 'bank_account', bank_name: 'Wells Fargo', last4: '3544' },
    ...over,
  });

  test('null while the flag is off, without an account, or before onboarding completes', async () => {
    process.env.STRIPE_CONNECT_ENABLED = 'false';
    expect(await service.payoutActivity('org_1')).toBeNull();
    process.env.STRIPE_CONNECT_ENABLED = 'true';
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await service.payoutActivity('org_1')).toBeNull();
    mockFindUnique.mockResolvedValueOnce(row({ detailsSubmitted: false }));
    expect(await service.payoutActivity('org_1')).toBeNull();
    mockFindUnique.mockResolvedValueOnce(row({ disconnectedAt: new Date() }));
    expect(await service.payoutActivity('org_1')).toBeNull();
    expect(mockBalanceRetrieve).not.toHaveBeenCalled();
  });

  test('reads balance and payouts on the connected account and maps cents to dollars', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    mockBalanceRetrieve.mockResolvedValueOnce({
      available: [{ amount: 50000, currency: 'usd' }],
      pending: [{ amount: 1250, currency: 'usd' }, { amount: 250, currency: 'usd' }],
    });
    mockPayoutsList.mockResolvedValueOnce({ data: [stripePayout(), stripePayout({ id: 'po_2', status: 'failed', failure_message: 'Account closed', destination: 'ba_1' })] });

    const activity = await service.payoutActivity('org_1');
    expect(mockBalanceRetrieve).toHaveBeenCalledWith({ stripeAccount: 'acct_1' });
    expect(mockPayoutsList).toHaveBeenCalledWith({ limit: 25, expand: ['data.destination'] }, { stripeAccount: 'acct_1' });
    expect(activity.error).toBeNull();
    expect(activity.balance).toEqual({ available: 500, pending: 15, currency: 'usd' });
    expect(activity.payouts).toHaveLength(2);
    expect(activity.payouts[0]).toEqual({
      id: 'po_1',
      amount: 123.45,
      currency: 'usd',
      status: 'paid',
      arrivalDate: '2026-09-16T00:00:00.000Z',
      createdAt: '2026-09-14T00:00:00.000Z',
      automatic: true,
      statementDescriptor: 'ROMAN SKIN',
      failureMessage: null,
      bank: { name: 'Wells Fargo', last4: '3544' },
    });
    // An unexpanded destination id is not a bank snapshot
    expect(activity.payouts[1]).toMatchObject({ status: 'failed', failureMessage: 'Account closed', bank: null });
  });

  test('a Stripe outage degrades to an error string instead of throwing', async () => {
    mockFindUnique.mockResolvedValueOnce(row());
    mockBalanceRetrieve.mockRejectedValueOnce(new Error('connection reset'));
    mockPayoutsList.mockResolvedValueOnce({ data: [] });
    const activity = await service.payoutActivity('org_1');
    expect(activity.balance).toBeNull();
    expect(activity.payouts).toEqual([]);
    expect(activity.error).toMatch(/could not be reached/);
  });

  test('serializePayout tolerates a bare object', () => {
    expect(serializePayout({ id: 'po_x' })).toMatchObject({ id: 'po_x', amount: 0, currency: 'usd', status: 'pending', arrivalDate: null, bank: null });
  });
});
