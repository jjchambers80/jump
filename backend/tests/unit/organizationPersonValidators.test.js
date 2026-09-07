import { jest } from '@jest/globals';
import { validateCreateOrganizationPerson } from '../../src/api/validators/organizationPersonValidators.js';

const validPayload = {
  firstName: '  Zoë  ',
  lastName: '  李  ',
  dateOfBirth: '2000-02-29',
  isAccountRepresentative: false,
};

function validate(body) {
  const req = { body };
  const next = jest.fn();

  validateCreateOrganizationPerson(req, {}, next);

  return { error: next.mock.calls[0]?.[0], body: req.body };
}

describe('validateCreateOrganizationPerson', () => {
  it('trims Unicode names and normalizes a leap-day DOB to UTC midnight', () => {
    const { error, body } = validate({ ...validPayload });

    expect(error).toBeUndefined();
    expect(body).toEqual({
      firstName: 'Zoë',
      lastName: '李',
      dateOfBirth: new Date('2000-02-29T00:00:00.000Z'),
      isAccountRepresentative: false,
    });
  });

  it.each([
    ['firstName', ''],
    ['firstName', '   '],
    ['firstName', 'a'.repeat(101)],
    ['lastName', null],
    ['lastName', 'b'.repeat(101)],
  ])('rejects invalid %s value', (field, value) => {
    const { error } = validate({ ...validPayload, [field]: value });

    expect(error?.statusCode).toBe(400);
  });

  it.each([
    '02/29/2000',
    '2000-2-29',
    '2025-02-29',
    '2020-13-01',
    '2020-01-32',
  ])('rejects malformed or impossible DOB %s', (dateOfBirth) => {
    const { error } = validate({ ...validPayload, dateOfBirth });

    expect(error?.statusCode).toBe(400);
  });

  it('rejects a future UTC calendar date', () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dateOfBirth = tomorrow.toISOString().slice(0, 10);

    const { error } = validate({ ...validPayload, dateOfBirth });

    expect(error?.statusCode).toBe(400);
    expect(error?.message).toMatch(/future/i);
  });

  it.each(['true', 1, null, undefined])(
    'requires isAccountRepresentative to be an actual boolean: %p',
    (isAccountRepresentative) => {
      const { error } = validate({ ...validPayload, isAccountRepresentative });

      expect(error?.statusCode).toBe(400);
    }
  );

  it.each(['organizationId', 'roles', 'email', 'ownershipPercentage']) (
    'rejects unknown field %s',
    (field) => {
      const { error } = validate({ ...validPayload, [field]: 'not-allowed' });

      expect(error?.statusCode).toBe(400);
      expect(error?.message).toMatch(/unknown field/i);
    }
  );

  it('rejects a missing or non-object body', () => {
    expect(validate(undefined).error?.statusCode).toBe(400);
    expect(validate(null).error?.statusCode).toBe(400);
    expect(validate([]).error?.statusCode).toBe(400);
  });
});
