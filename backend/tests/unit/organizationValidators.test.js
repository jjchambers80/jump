import { jest } from '@jest/globals';
import {
  validateUpdateBusinessDetails,
  validateUpdateOrganization,
  normalizeHexColor,
} from '../../src/api/validators/organizationValidators.js';

function validate(body) {
  const req = { body: { ...body } };
  const next = jest.fn();

  validateUpdateBusinessDetails(req, {}, next);

  return { error: next.mock.calls[0]?.[0], body: req.body };
}

const validBusinessDetails = {
  name: '  Example Company LLC  ',
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
  ])('rejects a missing required %s', (field, value) => {
    const { error } = validate({ ...validBusinessDetails, [field]: value });

    expect(error?.statusCode).toBe(400);
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
