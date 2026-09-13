// Public storefront (frontend) URLs used in emails.
//
// FRONTEND_URL is a comma-separated CORS allowlist (see server.js); the first
// entry is the canonical public origin. Spec 007 phase 3 will make this
// per-organization once custom domains exist.

export function storefrontBaseUrl() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:3001';
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

export function orderUrl(orderId) {
  return `${storefrontBaseUrl()}/orders/${orderId}`;
}

export function buyerAccountUrl(organizationId) {
  return `${storefrontBaseUrl()}/organizations/${organizationId}/account`;
}

export function buyerVerifyUrl(organizationId, rawToken) {
  return `${buyerAccountUrl(organizationId)}/verify?token=${encodeURIComponent(rawToken)}`;
}
