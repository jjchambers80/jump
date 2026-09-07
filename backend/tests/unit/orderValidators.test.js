import { jest } from '@jest/globals';
import { validateCreateOrder } from '../../src/api/validators/orderValidators.js';

function validate(body) {
  const req = { body };
  const next = jest.fn();

  validateCreateOrder(req, {}, next);

  return next.mock.calls[0]?.[0];
}

describe('validateCreateOrder', () => {
  const contact = {
    email: 'buyer@example.com',
    firstName: 'Test',
    lastName: 'Buyer',
  };

  it('accepts multiple price-tier items', () => {
    const error = validate({
      eventId: 'event-1',
      items: [
        { priceTierId: 'tier-1', quantity: 2 },
        { priceTierId: 'tier-2', quantity: 1 },
      ],
      contact,
    });

    expect(error).toBeUndefined();
  });

  it('rejects duplicate price tiers in a cart', () => {
    const error = validate({
      eventId: 'event-1',
      items: [
        { priceTierId: 'tier-1', quantity: 1 },
        { priceTierId: 'tier-1', quantity: 2 },
      ],
      contact,
    });

    expect(error.details).toContainEqual(
      expect.objectContaining({ field: 'items', message: 'price tiers must be unique' })
    );
  });
});
