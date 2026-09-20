// Organization Service
// CRUD operations for organizations per FR-048

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import storefrontPreferencesService from './StorefrontPreferencesService.js';
import { ConflictError, NotFoundError } from '../middleware/errorHandler.js';
import { formatEventSummary } from '../utils/eventSummary.js';
import { slugify } from '../utils/slug.js';

export const serializeBusinessDetails = (organization) => {
  const { ein, ...businessDetails } = organization;
  const lastFour = ein?.slice(-4);

  return {
    ...businessDetails,
    hasEin: Boolean(ein),
    einMasked: lastFour ? `••-•••${lastFour}` : null,
  };
};

// Staff counts come from OrganizationMember; keep the `_count.users` shape the
// admin UI already reads.
const withUserCount = ({ _count, ...org }) => ({
  ...org,
  _count: { venues: _count.venues, users: _count.members },
});

class OrganizationService {
  /**
   * First free slug derived from `raw` ("acme", then "acme-2", "acme-3", ...).
   * @param {string} raw - Name or requested slug
   * @param {string|null} exceptOrganizationId - Ignore this org's own slug (updates)
   */
  async uniqueSlug(raw, exceptOrganizationId = null) {
    const base = slugify(raw) || 'org';
    let slug = base;
    for (let i = 2; i < 1000; i += 1) {
      const clash = await prisma.organization.findFirst({
        where: { slug, NOT: exceptOrganizationId ? { id: exceptOrganizationId } : undefined },
        select: { id: true },
      });
      if (!clash) return slug;
      slug = `${base}-${i}`;
    }
    throw new ConflictError('Could not find a free organization slug');
  }

  /**
   * Create a new organization, already onboarded (the /signup flow is the
   * self-serve path; this one is for SYSTEM_ADMIN tooling, seeds and tests).
   * The creator becomes an ADMIN member so the organization shows up in
   * their switcher (spec 022).
   * @param {Object} data - { name }
   * @param {string} [creatorUserId] - User to add as ADMIN member
   * @returns {Promise<Object>} Created organization
   */
  async createOrganization(data, creatorUserId = null) {
    const organization = await prisma.organization.create({
      data: {
        name: data.name,
        slug: await this.uniqueSlug(data.name),
        ...(creatorUserId ? { members: { create: { userId: creatorUserId, role: 'ADMIN' } } } : {}),
      },
    });

    logger.info('Organization created', {
      event: 'organization_created',
      organizationId: organization.id,
      name: data.name,
      creatorUserId,
    });

    return organization;
  }

  /**
   * Get organization by ID
   * @param {string} id - Organization ID
   * @returns {Promise<Object|null>} Organization or null
   */
  async getOrganizationById(id) {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: { _count: { select: { venues: true, members: true } } },
    });
    return org ? withUserCount(org) : null;
  }

  /**
   * List all organizations
   * @returns {Promise<Array>} List of organizations
   */
  async listOrganizations({ includePending = false, withOnboarding = false } = {}) {
    const orgs = await prisma.organization.findMany({
      // Spec 022: organizations still in /signup are hidden from the switcher
      where: includePending ? undefined : { onboardingCompletedAt: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { venues: true, members: true } },
        // Spec 022 phase 3: survey answers and plan for the SYSTEM_ADMIN list only
        ...(withOnboarding ? { platformCustomer: { select: { plan: true, subscriptionStatus: true, onboarding: true } } } : {}),
      },
    });
    return orgs.map((org) => {
      const { platformCustomer, ...rest } = org;
      const base = withUserCount(rest);
      if (!withOnboarding) return base;
      const survey = platformCustomer?.onboarding ?? null;
      return {
        ...base,
        plan: platformCustomer?.plan ?? 'FREE',
        subscriptionStatus: platformCustomer?.subscriptionStatus ?? null,
        onboarding: survey
          ? {
              source: survey.source ?? null,
              goals: survey.goals ?? [],
              eventTypes: survey.eventTypes ?? [],
              eventsPerYear: survey.eventsPerYear ?? null,
              attendance: survey.attendance ?? null,
              movingFrom: survey.movingFrom ?? null,
              surveySkipped: Boolean(survey.surveySkippedAt),
            }
          : null,
      };
    });
  }

  /**
   * Organizations a user belongs to (via OrganizationMember), oldest membership first.
   * @param {string} userId
   */
  async listOrganizationsForUser(userId) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId, organization: { onboardingCompletedAt: { not: null } } },
      orderBy: { createdAt: 'asc' },
      include: { organization: { include: { _count: { select: { venues: true, members: true } } } } },
    });
    return memberships.map((m) => withUserCount(m.organization));
  }

  /**
   * Update an organization
   * @param {string} id - Organization ID
   * @param {Object} data - Fields to update { name?, slug?, status?, brandColor?, themeMode? }
   * @returns {Promise<Object>} Updated organization
   */
  async updateOrganization(id, data) {
    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    // The slug does not follow renames (URLs stay stable); it only changes
    // when set explicitly, and must be free.
    if (data.slug !== undefined) {
      const clash = await prisma.organization.findFirst({
        where: { slug: data.slug, NOT: { id } },
        select: { id: true },
      });
      if (clash) throw new ConflictError('That slug is already in use');
      updateData.slug = data.slug;
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.brandColor !== undefined) updateData.brandColor = data.brandColor;
    if (data.themeMode !== undefined) updateData.themeMode = data.themeMode;

    const organization = await prisma.organization.update({
      where: { id },
      data: updateData,
    });

    logger.info('Organization updated', {
      event: 'organization_updated',
      organizationId: organization.id,
      changes: Object.keys(updateData),
    });

    return organization;
  }

  /** Return masked business details for one organization. */
  async getBusinessDetails(organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    return organization ? serializeBusinessDetails(organization) : null;
  }

  /** Update one organization's business details and return a masked response. */
  async updateBusinessDetails(organizationId, data) {
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data,
    });

    logger.info('Organization business details updated', {
      event: 'organization_business_details_updated',
      organizationId: organization.id,
      changes: Object.keys(data),
    });

    return serializeBusinessDetails(organization);
  }

  /** Storefront homepage listing: falls back to the store name / no description. */
  async getPublicMeta(id) {
    const org = await prisma.organization.findFirst({
      where: { id, status: 'ACTIVE' },
      select: { id: true, name: true, seoTitle: true, seoDescription: true, coverUrl: true },
    });
    if (!org) throw new NotFoundError('Organization not found');
    return {
      id: org.id,
      name: org.name,
      title: org.seoTitle || org.name,
      description: org.seoDescription,
      // Social sharing image: the cover from Online store › Branding.
      imageUrl: org.coverUrl,
    };
  }

  /**
   * Get public organization info with published events.
   * A private storefront (Online Store › Preferences) without a valid
   * X-Storefront-Access token returns `locked: true`, the visitor message and
   * no events; branding stays so the password page can be styled.
   */
  async getPublicOrganization(id, { accessToken = null } = {}) {
    const org = await prisma.organization.findFirst({
      where: { id, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        coverUrl: true,
        brandColor: true,
        themeMode: true,
        storefrontPrivate: true,
        storefrontPasswordHash: true,
        storefrontMessage: true,
        buyerSignInLinks: true,
        buyerSignInMethod: true,
        venues: {
          select: {
            events: {
              where: { status: 'PUBLISHED' },
              orderBy: { date: 'asc' },
              select: {
                id: true,
                name: true,
                date: true,
                category: true,
                status: true,
                venue: { select: { id: true, name: true, address: true } },
                priceTiers: {
                  where: { isActive: true },
                  select: {
                    price: true,
                    quantityTotal: true,
                    quantitySold: true,
                    quantityReserved: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const organization = {
      id: org.id,
      name: org.name,
      logoUrl: org.logoUrl,
      coverUrl: org.coverUrl,
      brandColor: org.brandColor,
      themeMode: org.themeMode,
      // Spec 031: storefront header / checkout show the buyer sign-in link
      buyerSignInLinks: org.buyerSignInLinks,
      buyerSignInMethod: org.buyerSignInMethod,
    };

    if (!storefrontPreferencesService.hasAccess(org, accessToken)) {
      return { organization, locked: true, message: org.storefrontMessage, events: [] };
    }

    const events = org.venues.flatMap((v) => v.events).map(formatEventSummary);
    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    return { organization, locked: false, events };
  }

  /** Set or clear organization logo. */
  async setOrganizationLogo(id, logoUrl, imageId) {
    const existing = await prisma.organization.findUnique({
      where: { id },
      select: { logoUrl: true, logoImageId: true },
    });
    if (!existing) throw new NotFoundError('Organization not found');

    const data = { logoUrl };
    if (imageId !== undefined) data.logoImageId = imageId;

    const organization = await prisma.organization.update({ where: { id }, data });

    logger.info('Organization logo updated', {
      event: 'organization_logo_updated',
      organizationId: id,
      removed: logoUrl === null,
    });

    return { organization, previousLogoUrl: existing.logoUrl, previousLogoImageId: existing.logoImageId };
  }

  /** Set or clear organization cover image. */
  async setOrganizationCover(id, coverUrl, imageId) {
    const existing = await prisma.organization.findUnique({
      where: { id },
      select: { coverUrl: true, coverImageId: true },
    });
    if (!existing) throw new NotFoundError('Organization not found');

    const data = { coverUrl };
    if (imageId !== undefined) data.coverImageId = imageId;

    const organization = await prisma.organization.update({ where: { id }, data });

    logger.info('Organization cover updated', {
      event: 'organization_cover_updated',
      organizationId: id,
      removed: coverUrl === null,
    });

    return { organization, previousCoverUrl: existing.coverUrl, previousCoverImageId: existing.coverImageId };
  }
}

export default new OrganizationService();
