// Visitor-side storage for private storefront access tokens (Online store ›
// Preferences › Store access). The backend issues a token per organization
// from POST /organizations/:id/storefront-access; GET /organizations/:id/public
// reads it from the X-Storefront-Access header.

const PREFIX = 'jump.storefront-access.';

export function readStorefrontAccess(orgId: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + orgId);
  } catch {
    return null;
  }
}

export function writeStorefrontAccess(orgId: string, token: string) {
  try {
    window.localStorage.setItem(PREFIX + orgId, token);
  } catch {
    /* private mode / storage blocked: the visitor re-enters the password next time */
  }
}
