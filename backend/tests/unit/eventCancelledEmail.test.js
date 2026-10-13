// Spec 054-B: the buyer's "Event cancelled" email. One default template covers
// a refunded order, a store that handles refunds itself and an order with
// nothing to refund; the store's note is escaped text; the preview never needs
// a real buyer.

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/config/resend.js', () => ({ default: { emails: { send: jest.fn() } } }));

const { default: emailService } = await import('../../src/services/EmailService.js');
const { NOTIFICATIONS_BY_KEY } = await import('../../src/config/notifications.js');

const template = NOTIFICATIONS_BY_KEY.get('order.event_cancelled').defaults;
const order = {
  id: 'o1',
  orderRef: 'ORD-1',
  totalAmount: 42,
  quantity: 2,
  contact: { firstName: 'Sam', email: 'sam@example.com' },
  event: { name: 'Pixel Fair', date: '2027-09-18T23:00:00Z', venue: { timezone: 'America/New_York' } },
  organization: { id: 'org1', name: 'Retro Org', email: 'hello@retro.example' },
};
const build = (opts) => emailService.buildEventCancelled(order, { template, ...opts });

describe('order.event_cancelled', () => {
  it('is in the Orders group of the registry with both refund sections', () => {
    const entry = NOTIFICATIONS_BY_KEY.get('order.event_cancelled');
    expect(entry.group).toBe('orders');
    expect(entry.mergeFields.map(([k]) => k)).toEqual(expect.arrayContaining(['refund.issued', 'refund.manual', 'refund.amount', 'order.ref']));
  });

  it('refunded: names the amount, the 5–10 days and replies to the store', () => {
    const msg = build({ refund: 'issued', refundAmount: 42 });
    expect(msg.subject).toBe('Event Cancelled — Pixel Fair (ORD-1)');
    expect(msg.text).toContain("We've refunded $42.00 for your order ORD-1");
    expect(msg.text).toContain('5–10 business days');
    expect(msg.text).not.toContain('will contact you');
    expect(msg).toMatchObject({ to: ['sam@example.com'], reply_to: 'hello@retro.example' });
  });

  it('manual: the store will be in touch, no refund line', () => {
    const msg = build({ refund: 'manual' });
    expect(msg.text).toContain('Retro Org will contact you about your order ORD-1');
    expect(msg.text).not.toContain('Refunded $');
  });

  it('nothing to refund: neither section shows', () => {
    const msg = build({ refund: 'none' });
    expect(msg.text).toContain('Pixel Fair on');
    expect(msg.text).not.toContain('will contact you');
    expect(msg.text).not.toContain('refunded');
  });

  it("escapes the store's note", () => {
    const msg = build({ refund: 'manual', message: 'Sorry <script>alert(1)</script>' });
    expect(msg.text).toContain('Sorry <script>alert(1)</script>');
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });

  it('has a Settings › Notifications preview built from sample data', async () => {
    const preview = await emailService.previewNotification('order.event_cancelled', { name: 'Retro Org' }, template);
    expect(preview.subject).toContain('Sample event');
    expect(preview.text).toContain('Refunded $52.50');
  });
});
