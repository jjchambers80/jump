// Spec 050-G review: controls with no handler (the wizard's preview pane) are
// aria-disabled, stay focusable and point at a visible note saying why; with
// handlers (050-F draft preview) the steppers stay usable.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EventTickets from '@/app/events/[eventId]/EventTickets';
import EventCart from '@/app/events/[eventId]/EventCart';
import EventAddOns from '@/app/events/[eventId]/EventAddOns';
import { EMPTY_CART } from '@/app/events/[eventId]/useEventCart';
import { eventPageState, type EventPageEvent } from '@/app/events/[eventId]/eventPage';

const tier = {
  id: 't1', name: 'General', description: null, price: 20, quantityTotal: 100, quantitySold: 0, quantityReserved: 0,
  quantityAvailable: 100, displayOrder: 0, minPerOrder: 1, maxPerOrder: 10, isActive: true, isRefundable: true,
};
const event: EventPageEvent = {
  id: 'e1', name: 'Fair', date: '2031-06-01T20:00:00.000Z', capacity: null, status: 'DRAFT', taxRate: 0, venue: null, priceTiers: [tier],
};
const tickets = (handlers: { onQuantityChange?: () => void }) =>
  renderToStaticMarkup(
    <EventTickets event={event} state={eventPageState(event)} cart={EMPTY_CART} preview formattedDate="" {...handlers} />
  );
const increase = (html: string) => html.match(/<button[^>]*aria-label="Increase General quantity"[^>]*>/)![0];

describe('preview controls without a handler', () => {
  it('aria-disables the tier steppers and explains why', () => {
    const html = tickets({});
    expect(increase(html)).toContain('aria-disabled="true"');
    expect(increase(html)).toContain('aria-describedby="tickets-off"');
    expect(increase(html)).not.toMatch(/\sdisabled=""/);
    expect(html).toMatch(/id="tickets-off"[^>]*>Choosing tickets is off in preview/);
  });

  it('keeps the steppers usable when a handler is passed (050-F draft preview)', () => {
    const html = tickets({ onQuantityChange: () => {} });
    expect(increase(html)).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('tickets-off');
  });

  it('aria-disables the add-on steppers without a handler', () => {
    const addOn = { id: 'a1', name: 'Parking', description: null, price: 5, taxable: false, maxPerOrder: 4, remaining: null, soldOut: false, priceTierIds: ['t1'] };
    const html = renderToStaticMarkup(<EventAddOns offered={[addOn as never]} quantities={{}} taxRate={0} taxInclusive={false} />);
    expect(html).toMatch(/aria-label="Increase Parking quantity"[^>]*aria-disabled="true"[^>]*aria-describedby="add-ons-off"/);
    expect(html).toContain('Choosing add-ons is off in preview');
  });

  it('points the cart toggles and checkout at the cart note', () => {
    const html = renderToStaticMarkup(<EventCart cart={EMPTY_CART} preview={false} />);
    expect(html).toMatch(/id="checkout-off-desktop"[^>]*>Checkout is off in preview/);
    expect(html).toContain('aria-describedby="checkout-off-desktop"');
  });
});
