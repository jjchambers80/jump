import { ConflictError } from '../middleware/errorHandler.js';

/**
 * Spec 050-D: an organizer closed sales on this event (it stays PUBLISHED).
 * New ticket checkouts, RSVPs and application submissions are refused; an
 * approved vendor's select/pay, scanning and check-in never call this.
 * @param {{ salesClosedAt?: Date|null }} event
 */
export function assertSalesOpen(event) {
  if (!event?.salesClosedAt) return;
  const error = new ConflictError('Sales are closed for this event');
  error.code = 'SALES_CLOSED';
  throw error;
}
