// Organization routes
// CRUD endpoints for organization management per FR-048
// All routes require ADMIN role

import { Router } from 'express';
import { prisma } from '@jump/db';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import { requireAdmin, requireOrganizer, requireSystemAdmin } from '../../middleware/rbac.js';
import onboardingService from '../../services/OnboardingService.js';
import { requireOrgMembership } from '../../middleware/orgScope.js';
import {
  validateCreateOrganization,
  validateUpdateOrganization,
} from '../validators/organizationValidators.js';
import organizationService from '../../services/OrganizationService.js';
import { NotFoundError } from '../../middleware/errorHandler.js';
import { uploadImage } from '../../middleware/imageUpload.js';
import imageService, { dimensionQuery } from '../../services/ImageService.js';
import storefrontPreferencesService from '../../services/StorefrontPreferencesService.js';
import { validateStorefrontUnlock } from '../validators/storefrontPreferencesValidators.js';
import { gateByOrgParam } from '../../middleware/storefrontGate.js';
import blogPostService from '../../services/BlogPostService.js';
import galleryService from '../../services/GalleryService.js';
import pageService from '../../services/PageService.js';
import menuService from '../../services/MenuService.js';
import urlRedirectService from '../../services/UrlRedirectService.js';
import { findByPublicIdentifier } from '../../utils/publicIdentifier.js';
import { clientIpForRateLimit } from '../../utils/clientIp.js';
import themeService, { themesEnabledFor } from '../../services/ThemeService.js';
import themePreviewService, { THUMBNAIL_AUDIENCE } from '../../services/ThemePreviewService.js';
import contactInquiryService from '../../services/ContactInquiryService.js';
import { validateContactInquiry } from '../validators/contactInquiryValidators.js';
import { LIMITS, makeLimiter } from '../../middleware/rateLimit.js';

const router = Router();

const contactLimiter = makeLimiter('CONTACT_SUBMIT', LIMITS.CONTACT_SUBMIT);

const verifyOrgOwnership = requireOrgMembership('id');

// Storefront password guesses: browsers call this directly, so req.ip is the
// visitor (trust proxy is set in server.js). Keyed per organization too.
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Themed storefronts unlock through the Next route handler (spec 038), so
  // count the signed visitor IP, not the frontend server's (spec 020).
  keyGenerator: (req) => `${ipKeyGenerator(clientIpForRateLimit(req))}:${req.params.id}`,
  message: { message: 'Too many attempts. Try again later.' },
});

/**
 * POST /organizations
 * Create a new organization (admin only)
 */
router.post('/', requireAuth, requireAdmin, validateCreateOrganization, async (req, res, next) => {
  try {
    // SYSTEM_ADMIN has no memberships and sees every organization anyway;
    // an ADMIN needs the membership to see the organization they created.
    const creatorUserId = req.user.role === 'SYSTEM_ADMIN' ? null : req.user.id;
    const organization = await organizationService.createOrganization(req.body, creatorUserId);
    res.status(201).json(organization);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations
 * List all organizations (admin only)
 */
router.get('/', requireAuth, requireOrganizer, async (req, res, next) => {
  try {
    // SYSTEM_ADMIN: every organization. Staff: only the ones they belong to
    // (this list feeds the admin org switcher).
    const organizations =
      req.user.role === 'SYSTEM_ADMIN'
        ? await organizationService.listOrganizations({ includePending: req.query.includePending === '1', withOnboarding: true })
        : await organizationService.listOrganizationsForUser(req.user.id);
    res.json(organizations);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/onboarding/funnel
 * Signup funnel counts for the last 7 / 30 days (spec 022 phase 3). SYSTEM_ADMIN only.
 */
router.get('/onboarding/funnel', requireAuth, requireSystemAdmin, async (req, res, next) => {
  try {
    res.json(await onboardingService.funnel());
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:id
 * Get organization details (admin only)
 */
router.get('/:id', requireAuth, requireAdmin, verifyOrgOwnership, async (req, res, next) => {
  try {
    const organization = await organizationService.getOrganizationById(req.params.id);
    if (!organization) {
      throw new NotFoundError('Organization not found');
    }
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /organizations/:id
 * Update organization details (admin only)
 */
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  verifyOrgOwnership,
  validateUpdateOrganization,
  async (req, res, next) => {
    try {
      const organization = await organizationService.getOrganizationById(req.params.id);
      if (!organization) {
        throw new NotFoundError('Organization not found');
      }
      const updated = await organizationService.updateOrganization(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /organizations/:id/public
 * Get public organization info with published events (no auth)
 */
router.get('/:id/public', async (req, res, next) => {
  try {
    const result = await organizationService.getPublicOrganization(req.params.id, {
      accessToken: req.get('x-storefront-access') || null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:id/public/meta
 * Storefront homepage <title> / meta description / sharing image (no auth).
 * Used by the frontend's generateMetadata; works whether or not the store is private.
 */
router.get('/:id/public/meta', async (req, res, next) => {
  try {
    res.json(await organizationService.getPublicMeta(req.params.id));
  } catch (error) {
    next(error);
  }
});

/**
 * Public storefront content (specs 026 / 015): blog listing, blog post and
 * page. Gated by private store mode; hidden / scheduled records are 404.
 * Each payload carries the organization identity for the storefront shell.
 */
async function publicOrganizationIdentity(identifier) {
  const org = await findByPublicIdentifier(prisma.organization, identifier, {
    where: { status: 'ACTIVE' },
    select: { id: true, slug: true, name: true, logoUrl: true, coverUrl: true, brandColor: true, themeMode: true, buyerSignInLinks: true },
  });
  if (!org) throw new NotFoundError('Organization not found');
  return org;
}

/** Canonical route lookups used by permanent redirects from legacy ids. */
router.get('/:id/public/meta/pages/:identifier', async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const page = await pageService.getPublic(organization.id, req.params.identifier);
    res.json({
      organization: { id: organization.id, slug: organization.slug },
      page: { id: page.id, slug: page.slug },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/public/meta/blogs/:blogHandle/:identifier', async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const post = await blogPostService.publicGet(
      organization.id,
      req.params.blogHandle,
      req.params.identifier
    );
    res.json({
      organization: { id: organization.id, slug: organization.slug },
      post: { id: post.id, handle: post.handle, blog: { handle: post.blog.handle } },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/public/blogs/:blogHandle', gateByOrgParam, async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const result = await blogPostService.publicList(organization.id, req.params.blogHandle, req.query.page);
    res.json({ organization, ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/public/blogs/:blogHandle/:postHandle', gateByOrgParam, async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const post = await blogPostService.publicGet(organization.id, req.params.blogHandle, req.params.postHandle);
    // Spec 046: galleries the post embeds, resolved for this organization.
    const galleries = await galleryService.resolveInHtml(organization.id, post.content);
    res.json({ organization, post: { ...post, galleries } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:id/public/redirect?path= — URL redirect lookup (spec 028).
 * Not gated: a redirect reveals only a target path, which is gated itself.
 */
router.get('/:id/public/redirect', async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const hit = await urlRedirectService.resolve(organization.id, req.query.path);
    if (!hit) throw new NotFoundError('No redirect');
    res.set('Cache-Control', 'public, max-age=60');
    res.json(hit);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /organizations/:id/public/storefront/render?page=home|events|frame|page:<id or slug> (spec 038,
 * contracts C1). Everything a server-rendered themed page needs, in one call.
 * Organizations outside the rollout get `{ renderer: 'legacy' }` and nothing
 * else. The parameter MUST be `:id`: gateByOrgParam reads req.params.id, and
 * under any other name the private-store gate would silently pass.
 */
router.get(
  '/:id/public/storefront/render',
  (req, res, next) => {
    // Per-visitor answer (access token, gate): never shared by a cache.
    res.set('Cache-Control', 'private, no-store');
    next();
  },
  async (req, res, next) => {
    try {
      const organization = await findByPublicIdentifier(prisma.organization, req.params.id, {
        where: { status: 'ACTIVE' },
        select: { id: true, themesEnabled: true },
      });
      if (!organization) throw new NotFoundError('Organization not found');
      if (!themesEnabledFor(organization)) return res.json({ renderer: 'legacy' });
      req.themeOrganizationId = organization.id;
      // Draft preview (D11) or card thumbnail (C7): null = none sent, false = sent but not valid here.
      const thumbnailToken = req.get('X-Theme-Thumbnail');
      const previewToken = req.get('X-Theme-Preview');
      if (thumbnailToken) req.themePreview = themePreviewService.verify(thumbnailToken, organization.id, THUMBNAIL_AUDIENCE) ?? false;
      else if (previewToken) req.themePreview = themePreviewService.verify(previewToken, organization.id) ?? false;
      next();
    } catch (error) {
      next(error);
    }
  },
  // A staff preview renders past the store password; a share link does not (contracts C7).
  (req, res, next) => (req.themePreview && !req.themePreview.share ? next() : gateByOrgParam(req, res, next)),
  async (req, res, next) => {
    try {
      const result = await themeService.renderPublic(req.themeOrganizationId, String(req.query.page || 'home'), {
        preview: req.themePreview || null,
      });
      if (result.preview) res.set('X-Robots-Tag', 'noindex');
      // Tells the Next server to clear the cookie (Server Components cannot).
      else if (req.themePreview !== undefined) result.previewInvalid = true;
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /organizations/:id/public/menus — main + footer navigation (spec 027). */
router.get('/:id/public/menus', gateByOrgParam, async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await menuService.publicMenus(organization.id));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/public/pages/:slug', gateByOrgParam, async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const page = await pageService.getPublic(organization.id, req.params.slug);
    res.json({ organization, page });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:id/public/pages/:slug/contact
 * Contact-form message from a page whose template has a contact_form (spec
 * 042). Emailed to the store email with reply-to = visitor; nothing is
 * stored. 202 once sent, 502 CONTACT_SEND_FAILED when the email fails; a
 * filled honeypot gets the same 202 with nothing sent.
 */
router.post(
  '/:id/public/pages/:slug/contact',
  contactLimiter,
  gateByOrgParam,
  validateContactInquiry,
  async (req, res, next) => {
    try {
      const organization = await publicOrganizationIdentity(req.params.id);
      if (req.contactHoneypot) return res.status(202).json({ ok: true });
      await contactInquiryService.submit(organization.id, req.params.slug, req.body);
      res.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /organizations/:id/storefront-access
 * Exchange the store password for an access token (private mode). No auth.
 */
router.post('/:id/storefront-access', unlockLimiter, validateStorefrontUnlock, async (req, res, next) => {
  try {
    res.json(await storefrontPreferencesService.unlock(req.params.id, req.body.password));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:id/logo
 * Upload organization logo (admin only)
 */
router.post('/:id/logo', requireAuth, requireAdmin, verifyOrgOwnership, uploadImage, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const image = await imageService.processUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'org_logo'
    );
    const { organization, previousLogoImageId } = await organizationService.setOrganizationLogo(
      req.params.id,
      // The logo URL carries its pixel size so storefront headers reserve its box (no layout shift).
      `${image.urls.original}${dimensionQuery(image)}`,
      image.id
    );
    if (previousLogoImageId && previousLogoImageId !== image.id) {
      await imageService.deleteImage(previousLogoImageId).catch(() => {});
    }
    res.json({ ...organization, image });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /organizations/:id/logo
 * Remove organization logo (admin only)
 */
router.delete('/:id/logo', requireAuth, requireAdmin, verifyOrgOwnership, async (req, res, next) => {
  try {
    const { organization, previousLogoImageId } = await organizationService.setOrganizationLogo(
      req.params.id,
      null,
      null
    );
    if (previousLogoImageId) {
      await imageService.deleteImage(previousLogoImageId).catch(() => {});
    }
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /organizations/:id/cover
 * Upload organization cover image (admin only)
 */
router.post('/:id/cover', requireAuth, requireAdmin, verifyOrgOwnership, uploadImage, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const image = await imageService.processUpload(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'org_cover'
    );
    const { organization, previousCoverImageId } = await organizationService.setOrganizationCover(
      req.params.id,
      image.urls.original,
      image.id
    );
    if (previousCoverImageId && previousCoverImageId !== image.id) {
      await imageService.deleteImage(previousCoverImageId).catch(() => {});
    }
    res.json({ ...organization, image });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /organizations/:id/cover
 * Remove organization cover image (admin only)
 */
router.delete('/:id/cover', requireAuth, requireAdmin, verifyOrgOwnership, async (req, res, next) => {
  try {
    const { organization, previousCoverImageId } = await organizationService.setOrganizationCover(
      req.params.id,
      null,
      null
    );
    if (previousCoverImageId) {
      await imageService.deleteImage(previousCoverImageId).catch(() => {});
    }
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

export default router;
