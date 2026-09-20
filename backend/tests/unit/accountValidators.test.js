// Spec 030 feature A: partial account PATCH validation and normalization.

import { jest } from '@jest/globals';
import {
  normalizePhone,
  validateEmailChange,
  validateEmailConfirm,
  validateUpdateAccount,
} from '../../src/api/validators/accountValidators.js';
import { displayName } from '../../src/services/AccountService.js';
import { isValidTimeZone } from '../../src/utils/locales.js';

function run(validator, body) {
  const req = { body: body === undefined ? undefined : { ...body } };
  const next = jest.fn();
  validator(req, {}, next);
  return { error: next.mock.calls[0]?.[0], body: req.body };
}

describe('validateUpdateAccount', () => {
  it('trims names and normalizes the phone to E.164', () => {
    const { error, body } = run(validateUpdateAccount, {
      firstName: '  Ada ',
      lastName: 'Lovelace  ',
      phone: '(919) 555-0100',
      locale: 'en-US',
      timeZone: 'America/New_York',
    });
    expect(error).toBeUndefined();
    expect(body).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+19195550100',
      locale: 'en-US',
      timeZone: 'America/New_York',
    });
  });

  it('rejects unknown fields so a user id in the body is never a target', () => {
    const { error } = run(validateUpdateAccount, { firstName: 'Ada', id: 'someone-else' });
    expect(error?.message).toBe('Unknown field: id');
  });

  it('rejects an empty body', () => {
    expect(run(validateUpdateAccount, {}).error?.message).toBe('At least one field is required');
  });

  it('blank names and phone become null (removal)', () => {
    const { error, body } = run(validateUpdateAccount, { firstName: '   ', lastName: null, phone: '' });
    expect(error).toBeUndefined();
    expect(body).toEqual({ firstName: null, lastName: null, phone: null });
  });

  it('rejects an over-long name and an invalid phone', () => {
    expect(run(validateUpdateAccount, { firstName: 'x'.repeat(81) }).error?.message).toMatch(/80 characters/);
    expect(run(validateUpdateAccount, { phone: '123' }).error?.message).toBe('Enter a valid phone number');
  });

  it('accepts international numbers already in E.164', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('rejects an unsupported locale and an unknown time zone', () => {
    expect(run(validateUpdateAccount, { locale: 'fr-FR' }).error?.message).toMatch(/Language must be one of/);
    expect(run(validateUpdateAccount, { timeZone: 'Mars/Olympus' }).error?.message).toMatch(/IANA/);
  });

  it('empty time zone means browser default', () => {
    expect(run(validateUpdateAccount, { timeZone: '' }).body.timeZone).toBeNull();
  });
});

describe('validateEmailChange', () => {
  it('lowercases and trims', () => {
    expect(run(validateEmailChange, { email: '  New@Example.COM ' }).body.email).toBe('new@example.com');
  });
  it('rejects malformed addresses', () => {
    expect(run(validateEmailChange, { email: 'nope' }).error?.message).toMatch(/valid email/);
    expect(run(validateEmailChange, {}).error?.message).toMatch(/required/);
  });
});

describe('validateEmailConfirm', () => {
  it('accepts a base64url token and rejects junk', () => {
    expect(run(validateEmailConfirm, { token: 'a'.repeat(43) }).error).toBeUndefined();
    expect(run(validateEmailConfirm, { token: 'short' }).error?.message).toMatch(/invalid/);
    expect(run(validateEmailConfirm, { token: 'has spaces and more than twenty' }).error?.message).toMatch(/invalid/);
  });
});

describe('helpers', () => {
  it('displayName joins the parts and is null when both are empty', () => {
    expect(displayName('Ada', 'Lovelace')).toBe('Ada Lovelace');
    expect(displayName('Ada', null)).toBe('Ada');
    expect(displayName(null, null)).toBeNull();
  });
  it('isValidTimeZone uses Intl', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Nowhere/Land')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
