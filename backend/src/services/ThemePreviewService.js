// Draft theme preview links (spec 038 D11, contracts C7). A signed token names
// one theme of one organization; the Next route /api/storefront/preview keeps
// it in the host-only `jump_theme_preview` cookie and forwards it to the
// render endpoint as X-Theme-Preview.
//
// Staff links (1 h) render past a private store's password because only
// signed-in staff of that organization can mint them. Share links (14 d) do
// not: their visitor still meets the store gate.
//
// Thumbnails (contracts C7) are a second audience on the same secret: a
// 10-minute, cookie-free token per draft for the Online Store cards, sent as
// `/theme-thumbnail/:orgId?t=` and forwarded as X-Theme-Thumbnail.

import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '@jump/db';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { storefrontFor } from '../utils/storefrontUrl.js';

const AUDIENCE = 'theme-preview';
const STAFF_TTL_S = 60 * 60;
const SHARE_TTL_S = 14 * 24 * 60 * 60;
export const THUMBNAIL_AUDIENCE = 'theme-thumbnail';
const THUMBNAIL_TTL_S = 10 * 60;

// Never the raw AUTH_SECRET: a session verifier must not accept a preview token.
// Shared with EventPreviewService (spec 050 F); the audience keeps them apart.
export function previewSecret() {
  return (
    process.env.STOREFRONT_PREVIEW_SECRET ||
    createHmac('sha256', process.env.AUTH_SECRET || 'dev-secret').update('theme-preview').digest('hex')
  );
}

class ThemePreviewService {
  /** POST /admin/themes/:id/preview-link → { url, expiresAt, share }. Drafts only. */
  async mint(organizationId, themeId, { share = false } = {}) {
    const theme = await prisma.theme.findFirst({ where: { id: themeId, organizationId }, select: { id: true, role: true } });
    if (!theme) throw new NotFoundError('Theme not found');
    if (theme.role === 'MAIN') throw new ValidationError('The live theme has no preview: view the store instead');
    const ttl = share ? SHARE_TTL_S : STAFF_TTL_S;
    const token = jwt.sign({ orgId: organizationId, themeId, share: Boolean(share) }, previewSecret(), {
      algorithm: 'HS256',
      audience: AUDIENCE,
      expiresIn: ttl,
    });
    const { base } = await storefrontFor(organizationId);
    return {
      url: `${base}/api/storefront/preview?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      share: Boolean(share),
    };
  }

  /** GET /admin/themes/thumbnails → { thumbnails: { [draftId]: path } } (contracts C7). */
  async thumbnails(organizationId) {
    const drafts = await prisma.theme.findMany({ where: { organizationId, role: 'UNPUBLISHED' }, select: { id: true } });
    const thumbnails = {};
    for (const { id } of drafts) {
      const token = jwt.sign({ orgId: organizationId, themeId: id, page: 'home' }, previewSecret(), {
        algorithm: 'HS256',
        audience: THUMBNAIL_AUDIENCE,
        expiresIn: THUMBNAIL_TTL_S,
      });
      thumbnails[id] = `/theme-thumbnail/${encodeURIComponent(organizationId)}?t=${encodeURIComponent(token)}`;
    }
    return { thumbnails };
  }

  /** The token's claims when it is valid for this organization, else null. */
  verify(token, organizationId, audience = AUDIENCE) {
    if (!token) return null;
    try {
      const claims = jwt.verify(token, previewSecret(), { algorithms: ['HS256'], audience });
      if (claims.orgId !== organizationId || typeof claims.themeId !== 'string') return null;
      return {
        themeId: claims.themeId,
        share: Boolean(claims.share),
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        ...(audience === THUMBNAIL_AUDIENCE && { thumbnail: true }),
      };
    } catch {
      return null;
    }
  }
}

export default new ThemePreviewService();
