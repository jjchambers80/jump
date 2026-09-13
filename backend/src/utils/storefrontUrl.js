// Public storefront (frontend) URLs used in emails and Stripe redirects.
//
// Per organization (spec 007 phase 3): an organization with an ACTIVE custom
// domain gets links on that host; everyone else gets the platform frontend.
// FRONTEND_URL is a comma-separated CORS allowlist (see server.js); its first
// entry is the canonical platform origin.
//
// On a custom host the storefront paths are rewritten by frontend/middleware.ts
// (see frontend/src/lib/storefrontHost.ts): `/` is the org page and
// `/account` is the buyer account page, so links differ by host.

import domainService from '../services/DomainService.js';

export function platformBaseUrl() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:3001';
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

/** Kept for callers that have no organization context. */
export function storefrontBaseUrl() {
  return platformBaseUrl();
}

/**
 * Base URL for an organization's storefront.
 * @returns {Promise<{ base: string, custom: boolean }>}
 */
export async function storefrontFor(organizationId) {
  const host = await domainService.primaryHostname(organizationId).catch(() => null);
  if (host) return { base: `https://${host}`, custom: true };
  return { base: platformBaseUrl(), custom: false };
}

export async function orgPageUrl(organizationId) {
  const { base, custom } = await storefrontFor(organizationId);
  return custom ? `${base}/` : `${base}/organizations/${organizationId}`;
}

export async function orderUrl(orderId, organizationId) {
  const { base } = await storefrontFor(organizationId);
  return `${base}/orders/${orderId}`;
}

export async function eventUrl(eventId, organizationId, query = '') {
  const { base } = await storefrontFor(organizationId);
  return `${base}/events/${eventId}${query}`;
}

export async function confirmationUrl(orderId, organizationId) {
  const { base } = await storefrontFor(organizationId);
  return `${base}/confirmation?orderId=${orderId}`;
}

export async function buyerAccountUrl(organizationId) {
  const { base, custom } = await storefrontFor(organizationId);
  return custom ? `${base}/account` : `${base}/organizations/${organizationId}/account`;
}

export async function buyerVerifyUrl(organizationId, rawToken) {
  return `${await buyerAccountUrl(organizationId)}/verify?token=${encodeURIComponent(rawToken)}`;
}
