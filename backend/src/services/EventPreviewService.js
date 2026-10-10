// Private event previews (spec 050 §7.5, card 050-F). A signed token names one
// event of one organization; the Next route /api/events/preview keeps it in the
// host-only `jump_event_preview` cookie and the event page forwards it as
// X-Event-Preview, so staff see a DRAFT event on its real (themed) page.
//
// Same secret as theme previews (never the raw AUTH_SECRET, so it is never a
// session token); the `event-preview` audience keeps it from verifying as a
// theme preview and the reverse. Staff only, 1 h, no share variant.

import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';
import { NotFoundError } from '../middleware/errorHandler.js';
import { storefrontFor } from '../utils/storefrontUrl.js';
import { previewSecret } from './ThemePreviewService.js';

export const EVENT_PREVIEW_AUDIENCE = 'event-preview';
const TTL_S = 60 * 60;

class EventPreviewService {
  /** POST /organizations/:orgId/events/:eventId/preview-link → { url, expiresAt }. */
  async mint(organizationId, eventId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, venue: { organizationId } },
      select: { id: true },
    });
    if (!event) throw new NotFoundError('Event not found');
    // `typ`: even if STOREFRONT_PREVIEW_SECRET were set to AUTH_SECRET, requireAuth refuses a typed token.
    const token = jwt.sign({ typ: EVENT_PREVIEW_AUDIENCE, orgId: organizationId, eventId: event.id }, previewSecret(), {
      algorithm: 'HS256',
      audience: EVENT_PREVIEW_AUDIENCE,
      expiresIn: TTL_S,
    });
    const { base } = await storefrontFor(organizationId);
    return {
      url: `${base}/api/events/preview?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + TTL_S * 1000).toISOString(),
    };
  }

  /** Claims when the token is valid for this organization (any of its events), else null. */
  verifyOrganization(token, organizationId) {
    if (!token || !organizationId) return null;
    try {
      const claims = jwt.verify(token, previewSecret(), { algorithms: ['HS256'], audience: EVENT_PREVIEW_AUDIENCE });
      if (claims.typ !== EVENT_PREVIEW_AUDIENCE || claims.orgId !== organizationId || typeof claims.eventId !== 'string') return null;
      return { organizationId, eventId: claims.eventId, expiresAt: new Date(claims.exp * 1000).toISOString() };
    } catch {
      return null;
    }
  }

  /** Claims when the token is valid for exactly this organization and event, else null. */
  verify(token, organizationId, eventId) {
    const claims = this.verifyOrganization(token, organizationId);
    return claims && claims.eventId === eventId ? claims : null;
  }
}

export default new EventPreviewService();
