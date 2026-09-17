// Unit tests for PaymentSettingsService (spec 010 phase 1)
// Descriptor derivation and validation, method allowlist ∩ capabilities, and
// the checkout options Stripe receives — Prisma and Stripe mocked.

import { jest } from '@jest/globals';

const mockOrgFindUnique = jest.fn();
const mockOrgUpdate = jest.fn();
const mockAccountsRetrieve = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({
  prisma: { organization: { findUnique: mockOrgFindUnique, update: mockOrgUpdate } },
}));
jest.unstable_mockModule('../../src/config/stripe.js', () => ({
  default: { accounts: { retrieve: mockAccountsRetrieve } },
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// Connect routing (phase 2) is decided by ConnectService; pin its answer here.
const mockDestinationFor = jest.fn();
jest.unstable_mockModule('../../src/services/ConnectService.js', () => ({
  default: { destinationFor: mockDestinationFor },
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_unit';

const { default: service, deriveDescriptorSuffix, normalizeDescriptorText, suffixBudget, stripeMode, applicationFeeCents } = await import(
  '../../src/services/PaymentSettingsService.js'
);
const { default: feeService } = await import('../../src/services/FeeService.js');

const account = ({ prefix = 'JUMP', caps = {}, charges = true } = {}) => ({
  charges_enabled: charges,
  settings: { card_payments: { statement_descriptor_prefix: prefix } },
  capabilities: { link_payments: 'active', cashapp_payments: 'active', affirm_payments: 'inactive', ...caps },
});

const org = (over = {}) => ({
  id: 'org_1',
  name: 'Roman Skin Care',
  statementDescriptorSuffix: null,
  enabledPaymentMethods: [],
  paymentSettingsUpdatedAt: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  service._invalidate();
  mockDestinationFor.mockResolvedValue(null);
  mockAccountsRetrieve.mockResolvedValue(account());
  mockOrgUpdate.mockImplementation(({ data }) => Promise.resolve(org(data)));
});

describe('descriptor helpers', () => {
  test('normalizes case, strips disallowed characters, collapses spaces', () => {
    expect(normalizeDescriptorText("  roman's  skin & body! ")).toBe('ROMAN S SKIN BODY');
  });

  test('budget is 22 minus prefix minus "* "', () => {
    expect(suffixBudget('JUMP')).toBe(16);
    expect(suffixBudget('')).toBe(0);
    expect(suffixBudget(null)).toBe(0);
    expect(suffixBudget('X'.repeat(21))).toBe(0);
  });

  test('derives a suffix from the organization name cut to the budget', () => {
    expect(deriveDescriptorSuffix('Roman Skin Care', 'JUMP')).toBe('ROMAN SKIN CARE');
    expect(deriveDescriptorSuffix('The Carolina Theatre of Greensboro', 'JUMP')).toBe('THE CAROLINA THE');
    expect(deriveDescriptorSuffix('12345', 'JUMP')).toBeNull();
    expect(deriveDescriptorSuffix('Roman', null)).toBeNull();
  });

  test('stripeMode follows the key prefix', () => {
    expect(stripeMode()).toBe('test');
  });
});

describe('getProviderStatus', () => {
  test('reports prefix, capabilities and mode; cached across calls', async () => {
    const a = await service.getProviderStatus();
    const b = await service.getProviderStatus();
    expect(mockAccountsRetrieve).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toMatchObject({
      provider: 'STRIPE',
      mode: 'test',
      charges: 'active',
      statementDescriptorPrefix: 'JUMP',
      capabilities: { link: 'active', cashapp: 'active', affirm: 'inactive', klarna: null, afterpay_clearpay: null },
      manageUrl: 'https://dashboard.stripe.com/test/',
    });
  });

  test('test mode reports active charges even before the account is activated', async () => {
    mockAccountsRetrieve.mockResolvedValueOnce(account({ charges: false }));
    const status = await service.getProviderStatus();
    expect(status).toMatchObject({ mode: 'test', charges: 'active', error: null });
  });

  test('never throws: API failure reports unavailable', async () => {
    mockAccountsRetrieve.mockRejectedValueOnce(new Error('boom'));
    const status = await service.getProviderStatus();
    expect(status).toMatchObject({ charges: 'unavailable', statementDescriptorPrefix: null, capabilities: {}, error: 'boom' });
  });
});

describe('updateSettings — statement descriptor', () => {
  test('uppercases and stores a valid suffix', async () => {
    const result = await service.updateSettings('org_1', { statementDescriptorSuffix: 'roman skin' });
    expect(mockOrgUpdate.mock.calls[0][0].data.statementDescriptorSuffix).toBe('ROMAN SKIN');
    expect(result.descriptor).toMatchObject({ prefix: 'JUMP', suffix: 'ROMAN SKIN', full: 'JUMP* ROMAN SKIN', derived: false, budget: 16 });
  });

  test('rejects disallowed characters, no letters, and overlength', async () => {
    await expect(service.updateSettings('org_1', { statementDescriptorSuffix: 'ROMAN*SKIN' })).rejects.toThrow(/letters, numbers and spaces/);
    await expect(service.updateSettings('org_1', { statementDescriptorSuffix: '2026' })).rejects.toThrow(/at least one letter/);
    await expect(service.updateSettings('org_1', { statementDescriptorSuffix: 'A'.repeat(17) })).rejects.toThrow(/16 characters or fewer/);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  test('accepts exactly the budget', async () => {
    await service.updateSettings('org_1', { statementDescriptorSuffix: 'A'.repeat(16) });
    expect(mockOrgUpdate).toHaveBeenCalledTimes(1);
  });

  test('null clears the suffix back to derived', async () => {
    const result = await service.updateSettings('org_1', { statementDescriptorSuffix: null });
    expect(mockOrgUpdate.mock.calls[0][0].data.statementDescriptorSuffix).toBeNull();
    expect(result.descriptor).toMatchObject({ suffix: 'ROMAN SKIN CARE', derived: true });
  });

  test('refuses a suffix when the platform has no prefix', async () => {
    mockAccountsRetrieve.mockResolvedValueOnce(account({ prefix: null }));
    await expect(service.updateSettings('org_1', { statementDescriptorSuffix: 'ROMAN' })).rejects.toThrow(/no statement descriptor prefix/);
  });
});

describe('updateSettings — payment methods', () => {
  test('stores allowlisted, available methods in allowlist order, de-duplicated', async () => {
    await service.updateSettings('org_1', { enabledPaymentMethods: ['cashapp', 'link', 'cashapp'] });
    expect(mockOrgUpdate.mock.calls[0][0].data.enabledPaymentMethods).toEqual(['link', 'cashapp']);
  });

  test('rejects unknown methods and methods without an active capability', async () => {
    await expect(service.updateSettings('org_1', { enabledPaymentMethods: ['us_bank_account'] })).rejects.toThrow(/Unknown payment method/);
    await expect(service.updateSettings('org_1', { enabledPaymentMethods: ['affirm'] })).rejects.toThrow(/not available/);
    await expect(service.updateSettings('org_1', { enabledPaymentMethods: [42] })).rejects.toThrow(/array/);
  });

  test('empty body is rejected', async () => {
    await expect(service.updateSettings('org_1', {})).rejects.toThrow(/Nothing to update/);
  });
});

describe('getSettings', () => {
  test('serializes method rows with availability and the derived descriptor', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(org({ enabledPaymentMethods: ['cashapp', 'affirm'] }));
    const settings = await service.getSettings('org_1');
    const byType = Object.fromEntries(settings.methods.optional.map((m) => [m.type, m]));
    expect(byType.cashapp).toMatchObject({ available: true, enabled: true });
    expect(byType.affirm).toMatchObject({ available: false, enabled: false });
    expect(byType.link).toMatchObject({ available: true, enabled: false });
    expect(settings.descriptor.full).toBe('JUMP* ROMAN SKIN CARE');
    expect(settings.rates).toEqual({ platformFeePercent: 0.05, processingFeePercent: 0.029, processingFeeFixed: 0.3 });
  });

  test('404 for a missing organization', async () => {
    mockOrgFindUnique.mockResolvedValueOnce(null);
    await expect(service.getSettings('nope')).rejects.toThrow(/Organization not found/);
  });
});

describe('checkoutOptionsFor', () => {
  test('defaults to cards plus a derived suffix', async () => {
    expect(await service.checkoutOptionsFor(org())).toEqual({
      payment_method_types: ['card'],
      payment_intent_data: { statement_descriptor_suffix: 'ROMAN SKIN CARE' },
    });
  });

  test('sends enabled methods only when the capability is still active', async () => {
    const options = await service.checkoutOptionsFor(org({ enabledPaymentMethods: ['link', 'cashapp', 'affirm'] }));
    expect(options.payment_method_types).toEqual(['card', 'link', 'cashapp']);
  });

  test('drops a stored suffix that no longer fits the prefix instead of failing checkout', async () => {
    mockAccountsRetrieve.mockResolvedValueOnce(account({ prefix: 'JUMP TICKETING CO' }));
    const options = await service.checkoutOptionsFor(org({ statementDescriptorSuffix: 'ROMAN SKIN CARE' }));
    expect(options.payment_intent_data).toEqual({ statement_descriptor_suffix: 'ROM' });
  });

  test('omits the descriptor entirely when the platform has no prefix', async () => {
    mockAccountsRetrieve.mockResolvedValueOnce(account({ prefix: null }));
    const options = await service.checkoutOptionsFor(org({ statementDescriptorSuffix: 'ROMAN' }));
    expect(options).toEqual({ payment_method_types: ['card'] });
  });

  test('falls back to cards only when Stripe status is unavailable or the org is missing', async () => {
    mockAccountsRetrieve.mockRejectedValueOnce(new Error('down'));
    expect(await service.checkoutOptionsFor(org({ enabledPaymentMethods: ['link'] }))).toEqual({ payment_method_types: ['card'] });
    expect(await service.checkoutOptionsFor(null)).toEqual({ payment_method_types: ['card'] });
  });
});

// Build the Checkout line items exactly as OrderService does: all-in unit
// price = line total / quantity, rounded to cents.
function lineItemsFor(items, taxRate, taxInclusive = false) {
  const fees = feeService.computeOrderFees(items, taxRate, { taxInclusive });
  const lineItems = fees.itemBreakdowns.map((b) => ({
    price_data: { currency: 'usd', unit_amount: Math.round((b.lineTotal / b.quantity) * 100) },
    quantity: b.quantity,
  }));
  return { fees, lineItems };
}

describe('applicationFeeCents (spec 010 phase 2)', () => {
  const totalCents = (lineItems) => lineItems.reduce((s, i) => s + i.price_data.unit_amount * i.quantity, 0);

  test.each([
    ['single tier, tax on top', [{ unitPrice: 25, quantity: 2 }], 0.0725, false],
    ['single tier, no tax', [{ unitPrice: 25, quantity: 2 }], 0, false],
    ['tax-inclusive listing', [{ unitPrice: 25, quantity: 2 }], 0.0725, true],
    ['three tiers with rounding drift', [{ unitPrice: 19.99, quantity: 3 }, { unitPrice: 75, quantity: 1 }, { unitPrice: 5.55, quantity: 7 }], 0.08875, false],
    ['three tiers tax-inclusive', [{ unitPrice: 19.99, quantity: 3 }, { unitPrice: 75, quantity: 1 }, { unitPrice: 5.55, quantity: 7 }], 0.08875, true],
    ['one-cent ticket', [{ unitPrice: 0.01, quantity: 1 }], 0.07, false],
    ['free ticket', [{ unitPrice: 0, quantity: 3 }], 0.07, false],
  ])('%s: organization receives exactly the ex-tax subtotal', (_name, items, taxRate, taxInclusive) => {
    const { fees, lineItems } = lineItemsFor(items, taxRate, taxInclusive);
    const cents = applicationFeeCents({ fees, lineItems });
    expect(Number.isInteger(cents)).toBe(true);
    expect(cents).toBeGreaterThanOrEqual(0);
    expect(totalCents(lineItems) - cents).toBe(Math.round(fees.subtotal * 100));
  });

  test('platform keeps fees plus tax within per-unit rounding', () => {
    const { fees, lineItems } = lineItemsFor([{ unitPrice: 25, quantity: 2 }], 0.0725);
    const expected = Math.round((fees.platformFee + fees.processingFee + fees.tax) * 100);
    expect(Math.abs(applicationFeeCents({ fees, lineItems }) - expected)).toBeLessThanOrEqual(lineItems.length);
  });

  test('null for anything that cannot be right', () => {
    const { fees, lineItems } = lineItemsFor([{ unitPrice: 25, quantity: 2 }], 0);
    expect(applicationFeeCents(null)).toBeNull();
    expect(applicationFeeCents({ fees, lineItems: [] })).toBeNull();
    expect(applicationFeeCents({ fees: { subtotal: 'x' }, lineItems })).toBeNull();
    expect(applicationFeeCents({ fees: { subtotal: 999 }, lineItems })).toBeNull(); // subtotal above the charge
    expect(applicationFeeCents({ fees, lineItems: [{ price_data: { unit_amount: 12.5 }, quantity: 1 }] })).toBeNull();
    expect(applicationFeeCents({ fees, lineItems: [{ price_data: { unit_amount: 1250 }, quantity: 0 }] })).toBeNull();
  });
});

describe('checkoutOptionsFor with Connect routing (spec 010 phase 2)', () => {
  const charge = () => lineItemsFor([{ unitPrice: 25, quantity: 2 }], 0.0725);

  test('adds transfer_data and application_fee_amount when the organization has an active account', async () => {
    mockDestinationFor.mockResolvedValueOnce({ stripeAccountId: 'acct_1' });
    const { fees, lineItems } = charge();
    const options = await service.checkoutOptionsFor(org(), { fees, lineItems });
    expect(options.payment_intent_data).toEqual({
      statement_descriptor_suffix: 'ROMAN SKIN CARE',
      transfer_data: { destination: 'acct_1' },
      application_fee_amount: applicationFeeCents({ fees, lineItems }),
    });
    expect(mockDestinationFor).toHaveBeenCalledWith('org_1');
  });

  test('routes even when the platform has no descriptor prefix', async () => {
    mockAccountsRetrieve.mockResolvedValueOnce(account({ prefix: null }));
    mockDestinationFor.mockResolvedValueOnce({ stripeAccountId: 'acct_1' });
    const options = await service.checkoutOptionsFor(org(), charge());
    expect(options.payment_intent_data).toEqual({ transfer_data: { destination: 'acct_1' }, application_fee_amount: expect.any(Number) });
  });

  test('platform account when routing says no, when no charge context is given, or when the cents are inconsistent', async () => {
    const { fees, lineItems } = charge();
    expect((await service.checkoutOptionsFor(org(), { fees, lineItems })).payment_intent_data).toEqual({ statement_descriptor_suffix: 'ROMAN SKIN CARE' });

    expect((await service.checkoutOptionsFor(org())).payment_intent_data).toEqual({ statement_descriptor_suffix: 'ROMAN SKIN CARE' });
    expect(mockDestinationFor).toHaveBeenCalledTimes(1); // no charge → no routing lookup

    mockDestinationFor.mockResolvedValueOnce({ stripeAccountId: 'acct_1' });
    const bad = await service.checkoutOptionsFor(org(), { fees: { subtotal: 9999 }, lineItems });
    expect(bad.payment_intent_data).toEqual({ statement_descriptor_suffix: 'ROMAN SKIN CARE' });
  });

  test('a routing failure keeps the phase 1 options and charges on the platform account', async () => {
    mockDestinationFor.mockRejectedValueOnce(new Error('boom'));
    expect(await service.checkoutOptionsFor(org(), charge())).toEqual({
      payment_method_types: ['card'],
      payment_intent_data: { statement_descriptor_suffix: 'ROMAN SKIN CARE' },
    });
  });
});
