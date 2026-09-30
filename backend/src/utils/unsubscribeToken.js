// One-click unsubscribe tokens (spec 040 PA-08).
//
// A marketing email carries a link a recipient can use without signing in:
// `<contactId>.<hmac>`, where the HMAC covers the contact and its
// organization under AUTH_SECRET. No expiry — CAN-SPAM wants the link to work
// for at least 30 days, and there is nothing to gain by breaking an old one.
// The organization is part of the MAC, so a token never moves between tenants.

import { createHmac, timingSafeEqual } from 'crypto';
import { backendPublicUrl } from './publicUrl.js';
import { buyerAccountUrl } from './storefrontUrl.js';

function mac(contactId, organizationId) {
  return createHmac('sha256', process.env.AUTH_SECRET || '')
    .update(`unsubscribe:${contactId}:${organizationId}`)
    .digest('base64url');
}

/** @param {{ id: string, organizationId: string }} contact */
export function signUnsubscribeToken(contact) {
  return `${contact.id}.${mac(contact.id, contact.organizationId)}`;
}

/** Contact id the token names, or null when it is not token-shaped. The MAC is checked by `verifyUnsubscribeToken`. */
export function contactIdFromUnsubscribeToken(token) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [contactId, signature] = token.split('.');
  return contactId && signature ? contactId : null;
}

/** Whether `token` is the one issued for this contact. */
export function verifyUnsubscribeToken(token, contact) {
  if (!contact || contactIdFromUnsubscribeToken(token) !== contact.id) return false;
  const expected = Buffer.from(signUnsubscribeToken(contact));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * RFC 8058 headers for a marketing email (spec 013 sends; nothing sends
 * marketing mail yet). The header URL is the backend endpoint, which accepts
 * the mailbox provider's `List-Unsubscribe=One-Click` POST; the footer link
 * is the storefront page a person clicks (`unsubscribePageUrl`).
 * @param {{ id: string, organizationId: string }} contact
 */
export function listUnsubscribeHeaders(contact) {
  const url = `${backendPublicUrl()}/buyer/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(contact))}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Storefront page that confirms an unsubscribe for a person (footer link of a marketing email). */
export async function unsubscribePageUrl(contact) {
  return `${await buyerAccountUrl(contact.organizationId)}/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(contact))}`;
}
