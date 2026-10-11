import { ValidationError } from '../middleware/errorHandler.js';
import connectService from './ConnectService.js';

export const PAYMENTS_NOT_READY_MESSAGE = 'Set up payments in Settings › Payments before opening paid sales.';

/**
 * Preflight for organizer actions that make a paid offering available. Checkout
 * keeps its existing PAYMENTS_UNAVAILABLE refusal; this turns the same Connect
 * decision into an actionable validation error for the admin UI.
 */
export async function assertPaymentsReady(organizationId) {
  try {
    await connectService.chargeAccountFor(organizationId);
  } catch (error) {
    if (error?.code !== 'PAYMENTS_UNAVAILABLE') throw error;
    const readyError = new ValidationError(PAYMENTS_NOT_READY_MESSAGE, {
      settingsPath: '/admin/settings/payments',
    });
    readyError.code = 'PAYMENTS_NOT_READY';
    throw readyError;
  }
}
