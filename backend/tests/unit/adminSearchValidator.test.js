import { jest } from '@jest/globals';
import { validateAdminSearchQuery } from '../../src/api/validators/adminValidators.js';

function run(q) {
  const req = { query: q === undefined ? {} : { q } };
  const next = jest.fn();
  validateAdminSearchQuery(req, {}, next);
  return { req, error: next.mock.calls[0]?.[0] };
}

describe('validateAdminSearchQuery', () => {
  it.each([undefined, '', ' ', 'x', 'x'.repeat(201), 42])(
    'rejects an invalid q value %#',
    (q) => {
      const { error } = run(q);
      expect(error).toMatchObject({
        name: 'ValidationError',
        message: 'Validation failed',
        details: [{ field: 'q', message: 'q must be 2–200 characters' }],
      });
    }
  );

  it('trims a valid query and stores it for the route', () => {
    const { req, error } = run('  Needle  ');
    expect(error).toBeUndefined();
    expect(req.adminSearchQuery).toBe('Needle');
  });
});
