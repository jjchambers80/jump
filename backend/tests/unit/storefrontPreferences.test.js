// Unit tests for Online Store › Preferences: password hashing, access tokens,
// the private-mode invariants and the PATCH validator.

import { jest } from '@jest/globals';
import { validateUpdateStorefrontPreferences } from '../../src/api/validators/storefrontPreferencesValidators.js';

const organization = { findUnique: jest.fn(), update: jest.fn() };
jest.unstable_mockModule('@jump/db', () => ({ prisma: { organization } }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const {
  default: service,
  hashPassword,
  verifyPassword,
} = await import('../../src/services/StorefrontPreferencesService.js');

function validate(body) {
  const next = jest.fn();
  validateUpdateStorefrontPreferences({ body }, {}, next);
  return next.mock.calls[0]?.[0];
}

describe('storefront password hashing', () => {
  it('verifies the original password and rejects others', () => {
    const stored = hashPassword('open-sesame');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('open-sesame', stored)).toBe(true);
    expect(verifyPassword('open-sesamE', stored)).toBe(false);
    expect(verifyPassword('open-sesame', null)).toBe(false);
    expect(verifyPassword(undefined, stored)).toBe(false);
  });

  it('salts every hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('storefront access tokens', () => {
  const org = {
    id: 'org-1',
    storefrontPrivate: true,
    storefrontPasswordHash: hashPassword('pw-1'),
  };

  it('public stores never need a token', () => {
    expect(service.hasAccess({ ...org, storefrontPrivate: false }, null)).toBe(true);
  });

  it('a token unlocks its own organization only while the password is unchanged', () => {
    const token = service.accessToken(org);
    expect(service.hasAccess(org, token)).toBe(true);
    expect(service.hasAccess({ ...org, id: 'org-2' }, token)).toBe(false);
    expect(service.hasAccess({ ...org, storefrontPasswordHash: hashPassword('pw-2') }, token)).toBe(
      false
    );
    expect(service.hasAccess(org, 'not-a-token')).toBe(false);
    expect(service.hasAccess(org, null)).toBe(false);
  });
});

describe('StorefrontPreferencesService.update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    organization.update.mockImplementation(async ({ data }) => ({
      storefrontPrivate: false,
      storefrontPasswordHash: null,
      storefrontMessage: null,
      seoTitle: null,
      seoDescription: null,
      autoRedirectLanguage: false,
      ...data,
    }));
  });

  it('refuses private mode without a password', async () => {
    organization.findUnique.mockResolvedValue({
      id: 'org-1',
      storefrontPrivate: false,
      storefrontPasswordHash: null,
    });
    await expect(service.update('org-1', { storefrontPrivate: true })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(organization.update).not.toHaveBeenCalled();
  });

  it('refuses clearing the password while private', async () => {
    organization.findUnique.mockResolvedValue({
      id: 'org-1',
      storefrontPrivate: true,
      storefrontPasswordHash: 'scrypt$a$b',
    });
    await expect(service.update('org-1', { password: null })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('turns private mode on with a password in the same request and never returns the hash', async () => {
    organization.findUnique.mockResolvedValue({
      id: 'org-1',
      storefrontPrivate: false,
      storefrontPasswordHash: null,
    });
    const result = await service.update('org-1', {
      storefrontPrivate: true,
      password: 'secret1',
      storefrontMessage: '  Back soon  ',
    });
    const { data } = organization.update.mock.calls[0][0];
    expect(verifyPassword('secret1', data.storefrontPasswordHash)).toBe(true);
    expect(data.storefrontMessage).toBe('Back soon');
    expect(result).toEqual({
      storefrontPrivate: true,
      hasPassword: true,
      storefrontMessage: 'Back soon',
      seoTitle: null,
      seoDescription: null,
      autoRedirectLanguage: false,
    });
    expect(result).not.toHaveProperty('storefrontPasswordHash');
  });

  it('turns private mode off and clears the password together', async () => {
    organization.findUnique.mockResolvedValue({
      id: 'org-1',
      storefrontPrivate: true,
      storefrontPasswordHash: 'scrypt$a$b',
    });
    const result = await service.update('org-1', { storefrontPrivate: false, password: null });
    expect(organization.update.mock.calls[0][0].data).toEqual({
      storefrontPrivate: false,
      storefrontPasswordHash: null,
    });
    expect(result.hasPassword).toBe(false);
  });

  it('stores empty SEO text as null', async () => {
    organization.findUnique.mockResolvedValue({
      id: 'org-1',
      storefrontPrivate: false,
      storefrontPasswordHash: null,
    });
    await service.update('org-1', { seoTitle: '   ', seoDescription: 'Tickets for retro nights' });
    expect(organization.update.mock.calls[0][0].data).toEqual({
      seoTitle: null,
      seoDescription: 'Tickets for retro nights',
    });
  });
});

describe('validateUpdateStorefrontPreferences', () => {
  it('accepts a partial body of known fields', () => {
    expect(validate({ autoRedirectLanguage: true })).toBeUndefined();
    expect(validate({ password: null, storefrontPrivate: false })).toBeUndefined();
    expect(validate({ seoTitle: null, seoDescription: 'x'.repeat(160) })).toBeUndefined();
  });

  it('rejects empty bodies, unknown fields and bad types', () => {
    expect(validate({})?.details).toEqual([
      { field: 'body', message: 'At least one field is required' },
    ]);
    expect(validate({ storefrontPasswordHash: 'x' })?.details[0].field).toBe(
      'storefrontPasswordHash'
    );
    expect(validate({ storefrontPrivate: 'yes' })?.details[0].field).toBe('storefrontPrivate');
    expect(validate({ password: 123 })?.details[0].field).toBe('password');
  });

  it('enforces the length limits', () => {
    expect(validate({ password: 'abc' })?.details[0].message).toMatch(/4-100 characters/);
    expect(validate({ password: 'a'.repeat(101) })?.details[0].field).toBe('password');
    expect(validate({ seoTitle: 'x'.repeat(71) })?.details[0].message).toMatch(/70 characters/);
    expect(validate({ seoDescription: 'x'.repeat(161) })?.details[0].message).toMatch(
      /160 characters/
    );
    expect(validate({ storefrontMessage: 'x'.repeat(501) })?.details[0].message).toMatch(
      /500 characters/
    );
  });
});
