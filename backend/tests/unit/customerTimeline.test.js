import { describe, expect, it } from '@jest/globals';
import { buildTimeline, paginateTimeline } from '../../src/services/CustomerTimelineService.js';
import { normalizeCommentBody } from '../../src/api/validators/customerTimelineValidators.js';

const at = (iso) => new Date(iso);

describe('customer timeline', () => {
  it('merges comments and derived events newest first with stable id tie-breaking', () => {
    const items = buildTimeline({
      contact: {
        id: 'contact-1',
        createdAt: at('2026-01-01T00:00:00Z'),
        accountCreatedAt: at('2026-01-02T00:00:00Z'),
        emailSubscribedAt: at('2026-01-03T00:00:00Z'),
        emailSubscribedSource: 'CHECKOUT',
        emailUnsubscribedAt: null,
      },
      comments: [
        {
          id: 'comment-1',
          kind: 'COMMENT',
          body: 'Called customer',
          createdAt: at('2026-01-06T00:00:00Z'),
          author: { id: 'user-1', name: 'A Staff', email: 'staff@example.test' },
        },
      ],
      orders: [
        {
          id: 'order-1',
          orderRef: 'ORDER-1',
          totalAmount: 50,
          paidAt: at('2026-01-04T00:00:00Z'),
          event: { id: 'event-1', name: 'Expo' },
          payment: { id: 'payment-1', status: 'SUCCEEDED', createdAt: at('2026-01-04T00:00:00Z') },
          refunds: [
            {
              id: 'refund-1',
              amount: 20,
              status: 'SUCCEEDED',
              createdAt: at('2026-01-05T00:00:00Z'),
            },
          ],
          application: null,
        },
      ],
      applications: [],
    });

    expect(items.map(({ type }) => type)).toEqual([
      'COMMENT',
      'ORDER_PARTIALLY_REFUNDED',
      'ORDER_PAID',
      'MARKETING_SUBSCRIBED',
      'ACCOUNT_CREATED',
      'CONTACT_CREATED',
    ]);
    expect(items[1]).toMatchObject({ amount: 20, orderId: 'order-1', orderRef: 'ORDER-1' });
  });

  it('derives full refunds and application lifecycle decisions', () => {
    const items = buildTimeline({
      contact: { id: 'contact-1', createdAt: at('2026-01-01T00:00:00Z') },
      comments: [],
      orders: [
        {
          id: 'order-1',
          orderRef: 'ORDER-1',
          totalAmount: 50,
          paidAt: at('2026-01-02T00:00:00Z'),
          event: { id: 'event-1', name: 'Expo' },
          payment: { id: 'payment-1', status: 'SUCCEEDED', createdAt: at('2026-01-02T00:00:00Z') },
          refunds: [
            {
              id: 'refund-1',
              amount: 20,
              status: 'SUCCEEDED',
              createdAt: at('2026-01-03T00:00:00Z'),
            },
            {
              id: 'refund-2',
              amount: 30,
              status: 'SUCCEEDED',
              createdAt: at('2026-01-04T00:00:00Z'),
            },
          ],
          application: null,
        },
      ],
      applications: [
        {
          id: 'application-1',
          submittedAt: at('2026-01-05T00:00:00Z'),
          event: { id: 'event-1', name: 'Expo' },
          form: { id: 'form-1', name: 'Vendor' },
          decisions: [
            { id: 'decision-1', action: 'APPROVED', createdAt: at('2026-01-06T00:00:00Z') },
            { id: 'decision-2', action: 'REJECTED', createdAt: at('2026-01-07T00:00:00Z') },
          ],
        },
      ],
    });

    expect(items.map(({ type }) => type)).toEqual([
      'APPLICATION_REJECTED',
      'APPLICATION_APPROVED',
      'APPLICATION_SUBMITTED',
      'ORDER_REFUNDED',
      'ORDER_PARTIALLY_REFUNDED',
      'ORDER_PAID',
      'CONTACT_CREATED',
    ]);
  });

  it('derives RSVP creation and cancellation entries with event context', () => {
    const items = buildTimeline({
      contact: { id: 'contact-1', createdAt: at('2026-01-01T00:00:00Z') },
      rsvps: [
        {
          id: 'rsvp-1',
          partySize: 3,
          createdAt: at('2026-01-02T00:00:00Z'),
          cancelledAt: at('2026-01-03T00:00:00Z'),
          event: { id: 'event-1', name: 'Open House' },
        },
      ],
    });

    expect(items.slice(0, 2)).toEqual([
      expect.objectContaining({
        type: 'RSVP_CANCELLED',
        rsvpId: 'rsvp-1',
        partySize: 3,
        event: { id: 'event-1', name: 'Open House' },
      }),
      expect.objectContaining({ type: 'RSVP_CREATED', rsvpId: 'rsvp-1' }),
    ]);
  });

  it('paginates without duplicates when timestamps are equal', () => {
    const items = ['d', 'c', 'b', 'a'].map((id) => ({
      id,
      type: 'COMMENT',
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    const first = paginateTimeline(items, { limit: 2 });
    const second = paginateTimeline(items, { limit: 2, cursor: first.nextCursor });

    expect(first.data.map(({ id }) => id)).toEqual(['d', 'c']);
    expect(first.hasMore).toBe(true);
    expect(second.data.map(({ id }) => id)).toEqual(['b', 'a']);
    expect(second.hasMore).toBe(false);
  });
});

describe('customer comment validation', () => {
  it('accepts trimmed plain text at the 2000 character boundary', () => {
    expect(normalizeCommentBody(`  ${'a'.repeat(2000)}  `)).toHaveLength(2000);
  });

  it.each([null, '', '   ', '<b>hello</b>', 'a'.repeat(2001)])(
    'rejects invalid body %p',
    (body) => {
      expect(() => normalizeCommentBody(body)).toThrow();
    }
  );
});
