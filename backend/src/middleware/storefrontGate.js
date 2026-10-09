// Private storefront gate (Online Store › Preferences › Store access).
//
// `gateStorefront(resolve)` builds a middleware that finds the organization
// behind the request (`resolve(req)` returns `{ eventId }`, `{ venueId }` or
// `{ organizationId }`) and throws StorefrontLockedError (403) when the store
// is private and X-Storefront-Access holds no valid token for it. Unknown
// ids pass through so the route's own 404 wins.

import { prisma } from '@jump/db';
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
export const gateByOrgParam = gateStorefront((req) => ({ organizationIdentifier: req.params.id }));

/**
 * Suspension-only gate (no private-mode check) for routes reached by a link
 * or a buyer session rather than the storefront: a suspended organization
 * (status INACTIVE) takes no new money and holds no new capacity. 404.
 */
export function gateActiveOrg(resolve) {
  return async (req, res, next) => {
    try {
      await storefrontPreferencesService.assertActive(await resolve(req));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const activeOrgByApplicationParam = gateActiveOrg(async (req) => {
  const application = await prisma.application.findUnique({
    where: { id: String(req.params.id) },
    select: { organizationId: true },
  });
  return application?.organizationId ?? null;
});
export const activeOrgByBuyer = gateActiveOrg((req) => req.buyer?.organizationId);
