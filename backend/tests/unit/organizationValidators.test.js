import { jest } from '@jest/globals';
import {
  validateUpdateBusinessDetails,
  validateUpdateOrganization,
  normalizeHexColor,
  normalizeThemeMode,
} from '../../src/api/validators/organizationValidators.js';

function validate(body) {
  const req = { body: { ...body } };
  const next = jest.fn();

  validateUpdateBusinessDetails(req, {}, next);

  return { error: next.mock.calls[0]?.[0], body: req.body };
}

const validBusinessDetails = {
  name: '  Example Company LLC  ',
  companyName: ' Example Company Holdings LLC ',
  email: ' Owner@Example.com ',
  businessType: 'SINGLE_MEMBER_LLC',
  nickname: '  Example Co  ',
  countryCode: 'us',
  addressLine1: '  123 Main Street  ',
  addressLine2: ' Suite 4 ',
  city: '  Cary ',
  state: 'nc',
  postalCode: '27511-1234',
  phoneCountryCode: '+1',
  phoneNumber: '(919) 463-9575',
  ein: '12-3456789',
};

describe('validateUpdateBusinessDetails', () => {
  it('normalizes a complete valid payload', () => {
    const { error, body } = validate(validBusinessDetails);

    expect(error).toBeUndefined();
    expect(body).toEqual({
      name: 'Example Company LLC',
      companyName: 'Example Company Holdings LLC',
      email: 'owner@example.com',
      businessType: 'SINGLE_MEMBER_LLC',
      nickname: 'Example Co',
      countryCode: 'US',
      addressLine1: '123 Main Street',
      addressLine2: 'Suite 4',
      city: 'Cary',
      state: 'NC',
      postalCode: '27511-1234',
      phoneCountryCode: '+1',
      phoneNumber: '9194639575',
      ein: '123456789',
    });
  });

  it.each([
    ['name', ''],
    ['businessType', ''],
    ['addressLine1', ''],
    ['city', ''],
    ['state', ''],
    ['postalCode', ''],
  ])('rejects a blank %s when the key is present', (field, value) => {
    const { error } = validate({ ...validBusinessDetails, [field]: value });

    expect(error?.statusCode).toBe(400);
  });

  it('accepts a partial store-contact payload and leaves other keys untouched', () => {
    const { error, body } = validate({
      name: '  Roman Skin Studio ',
      email: '  Hello@Example.COM ',
      phoneCountryCode: '+1',
      phoneNumber: '(919) 555-1212',
    });

    expect(error).toBeUndefined();
    expect(body).toEqual({
      name: 'Roman Skin Studio',
      email: 'hello@example.com',
      phoneCountryCode: '+1',
      phoneNumber: '9195551212',
    });
  });

  it('accepts a partial store-address payload', () => {
    const { error, body } = validate({
      companyName: ' Roman Skin Care LLC ',
      countryCode: 'us',
      addressLine1: '24 Oak Avenue',
      addressLine2: '',
      city: 'Cary',
      state: 'nc',
      postalCode: '27511',
    });

    expect(error).toBeUndefined();
    expect(body).toEqual({
      companyName: 'Roman Skin Care LLC',
      countryCode: 'US',
      addressLine1: '24 Oak Avenue',
      addressLine2: null,
      city: 'Cary',
      state: 'NC',
      postalCode: '27511',
    });
  });

  it('rejects an empty payload', () => {
    const { error } = validate({});

    expect(error?.statusCode).toBe(400);
  });

  it.each(['not-an-email', 'two@@example.com', 'spaces in@example.com', 'noatsign.com'])(
    'rejects an invalid email %s',
    (email) => {
      const { error } = validate({ email });

      expect(error?.statusCode).toBe(400);
    }
  );

  it('allows email to be cleared with null or an empty string', () => {
    expect(validate({ email: null }).body.email).toBeNull();
    expect(validate({ email: '' }).body.email).toBeNull();
  });

  it.each([
    ['businessType', 'UNRECOGNIZED'],
    ['countryCode', 'CA'],
    ['state', 'North Carolina'],
    ['postalCode', '2751'],
    ['phoneCountryCode', '+44'],
    ['phoneNumber', '919-555'],
    ['phoneNumber', 'call9194639575'],
    ['ein', '12-34567'],
    ['ein', 'tax12-3456789'],
  ])('rejects an invalid %s', (field, value) => {
    const { error } = validate({ ...validBusinessDetails, [field]: value });

    expect(error?.statusCode).toBe(400);
  });

  it('rejects unknown fields', () => {
    const { error } = validate({ ...validBusinessDetails, organizationId: 'other-org' });

    expect(error?.statusCode).toBe(400);
    expect(error?.message).toMatch(/unknown field/i);
  });

  it('allows nullable optional fields and an explicitly cleared EIN', () => {
    const { error, body } = validate({
      ...validBusinessDetails,
      nickname: null,
      addressLine2: null,
      phoneNumber: null,
      ein: null,
    });

    expect(error).toBeUndefined();
    expect(body.nickname).toBeNull();
    expect(body.addressLine2).toBeNull();
    expect(body.phoneNumber).toBeNull();
    expect(body.ein).toBeNull();
  });

  it('allows EIN to be omitted so the stored value is preserved', () => {
    const payload = { ...validBusinessDetails };
    delete payload.ein;

    const { error, body } = validate(payload);

    expect(error).toBeUndefined();
    expect(body).not.toHaveProperty('ein');
  });
});

function validateUpdate(body) {
  const req = { body: { ...body } };
  const next = jest.fn();

  validateUpdateOrganization(req, {}, next);

  return { error: next.mock.calls[0]?.[0], body: req.body };
}

describe('normalizeHexColor', () => {
  it('lowercases a 6-digit hex', () => {
    expect(normalizeHexColor('#1D4ED8')).toBe('#1d4ed8');
  });

  it('expands a 3-digit hex', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeHexColor('  #1d4ed8 ')).toBe('#1d4ed8');
  });

  it.each(['red', '#ggg', '#12345', '1d4ed8', '', 123, null, undefined])(
    'returns null for invalid input %p',
    (value) => {
      expect(normalizeHexColor(value)).toBeNull();
    }
  );
});

describe('validateUpdateOrganization brandColor', () => {
  it('accepts and normalizes a 6-digit hex', () => {
    const { error, body } = validateUpdate({ brandColor: '#1D4ED8' });

    expect(error).toBeUndefined();
    expect(body.brandColor).toBe('#1d4ed8');
  });

  it('expands a 3-digit hex', () => {
    const { error, body } = validateUpdate({ brandColor: '#ABC' });

    expect(error).toBeUndefined();
    expect(body.brandColor).toBe('#aabbcc');
  });

  it('allows null to clear the color', () => {
    const { error, body } = validateUpdate({ brandColor: null });

    expect(error).toBeUndefined();
    expect(body.brandColor).toBeNull();
  });

  it('leaves brandColor untouched when omitted', () => {
    const { error, body } = validateUpdate({ name: 'Org' });

    expect(error).toBeUndefined();
    expect(body).not.toHaveProperty('brandColor');
  });

  it.each(['red', '#ggg', '#12345', 123, {}])('rejects invalid value %p', (value) => {
    const { error } = validateUpdate({ brandColor: value });

    expect(error?.statusCode).toBe(400);
    expect(error?.message).toBe('Brand color must be a hex value like #1d4ed8');
  });
});

describe('normalizeThemeMode', () => {
  it.each([
    ['LIGHT', 'LIGHT'],
    ['dark', 'DARK'],
    [' system ', 'SYSTEM'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeThemeMode(input)).toBe(expected);
  });

  it.each(['blue', 'auto', 'USER', '', 123, null, undefined, {}])('returns null for invalid input %p', (value) => {
    expect(normalizeThemeMode(value)).toBeNull();
  });
});

describe('validateUpdateOrganization themeMode', () => {
  it.each(['LIGHT', 'DARK', 'SYSTEM'])('accepts %s', (mode) => {
    const { error, body } = validateUpdate({ themeMode: mode });

    expect(error).toBeUndefined();
    expect(body.themeMode).toBe(mode);
  });

  it('uppercases lowercase input', () => {
    const { error, body } = validateUpdate({ themeMode: 'dark' });

    expect(error).toBeUndefined();
    expect(body.themeMode).toBe('DARK');
  });

  it('leaves themeMode untouched when omitted', () => {
    const { error, body } = validateUpdate({ name: 'Org' });

    expect(error).toBeUndefined();
    expect(body).not.toHaveProperty('themeMode');
  });

  it.each(['blue', 'auto', 'USER', null, 123, {}])('rejects invalid value %p', (value) => {
    const { error } = validateUpdate({ themeMode: value });

    expect(error?.statusCode).toBe(400);
    expect(error?.message).toBe('Theme mode must be one of: LIGHT, DARK, SYSTEM');
  });
});
