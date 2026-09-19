// Private storefront gate (Online Store › Preferences › Store access).
//
// `gateStorefront(resolve)` builds a middleware that finds the organization
// behind the request (`resolve(req)` returns `{ eventId }`, `{ venueId }` or
// `{ organizationId }`) and throws StorefrontLockedError (403) when the store
// is private and X-Storefront-Access holds no valid token for it. Unknown
// ids pass through so the route's own 404 wins.

import storefrontPreferencesService from '../services/StorefrontPreferencesService.js';

export function gateStorefront(resolve) {
  return async (req, res, next) => {
    try {
      const ref = resolve(req) || {};
      const organizationId =
        ref.organizationId ?? (await storefrontPreferencesService.organizationIdFor(ref));
      await storefrontPreferencesService.assertAccess(organizationId, req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const gateByEventParam = gateStorefront((req) => ({ eventId: req.params.eventId }));
export const gateByVenueParam = gateStorefront((req) => ({ venueId: req.params.venueId }));
export const gateByEventBody = gateStorefront((req) => ({ eventId: req.body?.eventId }));
