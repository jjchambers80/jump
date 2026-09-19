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
import imageService from '../../services/ImageService.js';
import storefrontPreferencesService from '../../services/StorefrontPreferencesService.js';
import { validateStorefrontUnlock } from '../validators/storefrontPreferencesValidators.js';
import { gateByOrgParam } from '../../middleware/storefrontGate.js';
import blogPostService from '../../services/BlogPostService.js';
import pageService from '../../services/PageService.js';
import menuService from '../../services/MenuService.js';
import urlRedirectService from '../../services/UrlRedirectService.js';

const router = Router();

const verifyOrgOwnership = requireOrgMembership('id');

// Storefront password guesses: browsers call this directly, so req.ip is the
// visitor (trust proxy is set in server.js). Keyed per organization too.
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.params.id}`,
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
router.get('/:id', requireAuth, requireAdmin, async (req, res, next) => {
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
async function publicOrganizationIdentity(id) {
  const org = await prisma.organization.findFirst({
    where: { id, status: 'ACTIVE' },
    select: { id: true, name: true, logoUrl: true, coverUrl: true, brandColor: true, themeMode: true },
  });
  if (!org) throw new NotFoundError('Organization not found');
  return org;
}

router.get('/:id/public/blogs/:blogHandle', gateByOrgParam, async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const result = await blogPostService.publicList(req.params.id, req.params.blogHandle, req.query.page);
    res.json({ organization, ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/public/blogs/:blogHandle/:postHandle', gateByOrgParam, async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const post = await blogPostService.publicGet(req.params.id, req.params.blogHandle, req.params.postHandle);
    res.json({ organization, post });
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
    const hit = await urlRedirectService.resolve(req.params.id, req.query.path);
    if (!hit) throw new NotFoundError('No redirect');
    res.set('Cache-Control', 'public, max-age=60');
    res.json(hit);
  } catch (error) {
    next(error);
  }
});

/** GET /organizations/:id/public/menus — main + footer navigation (spec 027). */
router.get('/:id/public/menus', gateByOrgParam, async (req, res, next) => {
  try {
    await publicOrganizationIdentity(req.params.id);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await menuService.publicMenus(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/public/pages/:slug', gateByOrgParam, async (req, res, next) => {
  try {
    const organization = await publicOrganizationIdentity(req.params.id);
    const page = await pageService.getPublic(req.params.id, req.params.slug);
    res.json({ organization, page });
  } catch (error) {
    next(error);
  }
});

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
      image.urls.original,
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
