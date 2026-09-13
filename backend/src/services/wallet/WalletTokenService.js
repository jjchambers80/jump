// Wallet access tokens
// Per-ticket bearer token that lets a buyer download a wallet pass from an
// email link without signing in (guest checkout). Stateless: derived from
// AUTH_SECRET with HMAC-SHA256, so nothing is stored and the token cannot be
// guessed from the ticket id. Ticket status is re-checked on every download,
// so a refunded ticket's link stops working without any revocation list.

import { createHmac, timingSafeEqual } from 'crypto';
import { isAppleConfigured, isGoogleConfigured, backendPublicUrl } from '../../config/wallet.js';

const TOKEN_BYTES = 24; // 32 base64url chars

class WalletTokenService {
  _secret() {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error('AUTH_SECRET environment variable is required for wallet tokens');
    }
    return secret;
  }

  /**
   * @param {string} ticketId
   * @returns {string} base64url token
   */
  issue(ticketId) {
    return createHmac('sha256', this._secret())
      .update(`wallet:${ticketId}`)
      .digest()
      .subarray(0, TOKEN_BYTES)
      .toString('base64url');
  }

  /**
   * Constant-time comparison of a presented token against the expected one.
   * @param {string} ticketId
   * @param {string} token
   * @returns {boolean}
   */
  verify(ticketId, token) {
    if (typeof token !== 'string' || !token) return false;
    const expected = Buffer.from(this.issue(ticketId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  /**
   * Absolute wallet download links for a ticket, for API responses and emails.
   * A provider that is not configured yields null so clients hide its button.
   * Non-VALID tickets get no links at all.
   *
   * @param {{ id: string, status: string }} ticket
   * @returns {{ apple: string|null, google: string|null }}
   */
  links(ticket) {
    if (!ticket || ticket.status !== 'VALID') {
      return { apple: null, google: null };
    }
    const base = backendPublicUrl();
    const t = encodeURIComponent(this.issue(ticket.id));
    return {
      apple: isAppleConfigured() ? `${base}/wallet/apple/${ticket.id}.pkpass?t=${t}` : null,
      google: isGoogleConfigured() ? `${base}/wallet/google/${ticket.id}?t=${t}` : null,
    };
  }
}

export default new WalletTokenService();
