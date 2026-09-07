import { formatEventSummary } from '../../src/utils/eventSummary.js';

describe('formatEventSummary', () => {
  it('uses active price tiers to calculate price range and availability', () => {
    const event = {
      id: 'event-1',
      name: 'Example Event',
      date: new Date('2027-07-15T19:00:00.000Z'),
      category: 'music',
      status: 'PUBLISHED',
      venue: { id: 'venue-1', name: 'Example Venue', address: '1 Main St' },
      priceTiers: [
        {
          price: { toString: () => '25.00' },
          quantityTotal: 50,
          quantitySold: 8,
          quantityReserved: 2,
        },
        {
          price: 75,
          quantityTotal: 20,
          quantitySold: 5,
          quantityReserved: 0,
        },
      ],
    };

    expect(formatEventSummary(event)).toEqual({
      id: 'event-1',
      name: 'Example Event',
      date: event.date,
      venue: event.venue,
      category: 'music',
      status: 'PUBLISHED',
      priceRange: { min: 25, max: 75 },
      availableTickets: 55,
    });
  });

  it('returns no price range and zero availability when there are no active tiers', () => {
    const event = {
      id: 'event-2',
      name: 'Free Event',
      date: new Date('2027-07-16T19:00:00.000Z'),
      category: null,
      status: 'PUBLISHED',
      venue: { id: 'venue-1', name: 'Example Venue', address: '1 Main St' },
      priceTiers: [],
    };

    expect(formatEventSummary(event)).toMatchObject({
      priceRange: null,
      availableTickets: 0,
    });
  });
});
