// Organization Service
// CRUD operations for organizations per FR-048

import { prisma, Prisma } from '@jump/db';
import { faviconUrlFor, storefrontLogoFor } from './storefrontLogo.js';
import logger from '../utils/logger.js';
import storefrontPreferencesService from './StorefrontPreferencesService.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import { formatEventSummary } from '../utils/eventSummary.js';
import { RESERVED_ORGANIZATION_SLUGS, rethrowSlugConflict, resolveUniqueSlug, uniqueSlug } from '../utils/slug.js';
import { findByPublicIdentifier } from '../utils/publicIdentifier.js';

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

const SYSTEM_ORG_INCLUDE = {
  _count: { select: { venues: true, members: true } },
  platformCustomer: { select: { plan: true, subscriptionStatus: true } },
};

/** Row shape of the system administration organization list (spec: system admin). */
const systemOrgRow = (org) => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  status: org.status,
  createdAt: org.createdAt,
  onboardingCompletedAt: org.onboardingCompletedAt,
  memberCount: org._count.members,
  venueCount: org._count.venues,
  plan: org.platformCustomer?.plan ?? null,
  subscriptionStatus: org.platformCustomer?.subscriptionStatus ?? null,
});

/** Spec 049 brand identity fields carried by public organization payloads. */
export const BRAND_IDENTITY_SELECT = {
  squareLogoUrl: true,
  brandSecondaryColor: true,
  slogan: true,
  shortDescription: true,
  socialLinks: true,
};

/** Published events of an organization, as the storefront lists them. */
export const PUBLIC_EVENTS_QUERY = {
  where: { status: 'PUBLISHED' },
  orderBy: { date: 'asc' },
  select: {
    id: true,
    slug: true,
    name: true,
    date: true,
    category: true,
    logoUrl: true,
    status: true,
    admissionMode: true,
    rsvpLimit: true,
    rsvpMaxPartySize: true,
    venue: { select: { id: true, slug: true, name: true, address: true, timezone: true } },
    priceTiers: {
      where: { isActive: true },
      select: { price: true, quantityTotal: true, quantitySold: true, quantityReserved: true },
    },
  },
};

/** Storefront event summaries of an organization, soonest first. */
export async function publicEventSummaries(organizationId) {
  const events = await prisma.event.findMany({
    ...PUBLIC_EVENTS_QUERY,
    where: { ...PUBLIC_EVENTS_QUERY.where, venue: { organizationId } },
  });
  return events.map(formatEventSummary);
}

class OrganizationService {
  /**
   * First free slug derived from `raw` ("acme", then "acme-2", "acme-3", ...).
   * @param {string} raw - Name or requested slug
   * @param {string|null} exceptOrganizationId - Ignore this org's own slug (updates)
   */
  async uniqueSlug(raw, exceptOrganizationId = null) {
    return uniqueSlug(prisma.organization, {
      raw,
      exceptId: exceptOrganizationId,
      fallback: 'org',
      maxAttempts: 999,
      reserved: RESERVED_ORGANIZATION_SLUGS,
    });
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
    const slugState = await resolveUniqueSlug(prisma.organization, {
      title: data.name,
      customSlug: data.slug,
      fallback: 'org',
      reserved: RESERVED_ORGANIZATION_SLUGS,
    });
    let organization;
    try {
      organization = await prisma.organization.create({
        data: {
          name: data.name,
          ...slugState,
          ...(creatorUserId ? { members: { create: { userId: creatorUserId, role: 'ADMIN' } } } : {}),
        },
      });
    } catch (error) {
      rethrowSlugConflict(error);
    }

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
   * System administration list (SYSTEM_ADMIN only): every organization,
   * pending signups included, searchable and paginated.
   * @param {{ q?: string, status?: 'ACTIVE'|'INACTIVE'|'PENDING', page?: number, limit?: number }} options
   *   PENDING = still in /signup (onboardingCompletedAt null), whatever its status.
   */
  async listOrganizationsPage({ q, status, page = 1, limit = 20 } = {}) {
    const where = {};
    if (status === 'PENDING') where.onboardingCompletedAt = null;
    else if (status) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [orgs, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: SYSTEM_ORG_INCLUDE,
      }),
      prisma.organization.count({ where }),
    ]);
    return {
      organizations: orgs.map(systemOrgRow),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** One organization in the system administration row shape, or null. */
  async getSystemOrganization(id) {
    const org = await prisma.organization.findUnique({ where: { id }, include: SYSTEM_ORG_INCLUDE });
    return org ? systemOrgRow(org) : null;
  }

  /**
   * Organizations a user belongs to (via OrganizationMember), oldest membership first.
   * @param {string} userId
   */
  async listOrganizationsForUser(userId) {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId, organization: { onboardingCompletedAt: { not: null }, status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      include: { organization: { include: { _count: { select: { venues: true, members: true } } } } },
    });
    return memberships.map((m) => withUserCount(m.organization));
  }

  /**
   * Update an organization
   * @param {string} id - Organization ID
   * @param {Object} data - Fields to update { name?, slug?, status?, brandColor?, brandSecondaryColor?, themeMode?, slogan?, shortDescription?, socialLinks? }
   * @returns {Promise<Object>} Updated organization
   */
  async updateOrganization(id, data) {
    const existing = await prisma.organization.findUnique({
      where: { id },
      select: { name: true, slug: true, slugCustomized: true },
    });
    if (!existing) throw new NotFoundError('Organization not found');
    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.name !== undefined || data.slug !== undefined) {
      Object.assign(
        updateData,
        await resolveUniqueSlug(prisma.organization, {
          title: data.name ?? existing.name,
          customSlug: data.slug,
          currentSlug: existing.slug,
          slugCustomized: existing.slugCustomized,
          exceptId: id,
          fallback: 'org',
          reserved: RESERVED_ORGANIZATION_SLUGS,
        })
      );
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.brandColor !== undefined) updateData.brandColor = data.brandColor;
    if (data.themeMode !== undefined) updateData.themeMode = data.themeMode;
    for (const field of ['brandSecondaryColor', 'slogan', 'shortDescription']) {
      if (data[field] !== undefined) updateData[field] = data[field];
    }
    // Prisma needs DbNull to clear a nullable Json column.
    if (data.socialLinks !== undefined) updateData.socialLinks = data.socialLinks ?? Prisma.DbNull;

    let organization;
    try {
      organization = await prisma.organization.update({ where: { id }, data: updateData });
    } catch (error) {
      rethrowSlugConflict(error);
    }

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
  async getPublicMeta(identifier) {
    const org = await findByPublicIdentifier(prisma.organization, identifier, {
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, name: true, logoUrl: true, seoTitle: true, seoDescription: true, coverUrl: true, squareLogoUrl: true, themesEnabled: true },
    });
    if (!org) throw new NotFoundError('Organization not found');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      // Staff invite sign-in page ("Join <Org> on Eventimus")
      logoUrl: org.logoUrl,
      title: org.seoTitle || org.name,
      description: org.seoDescription,
      // Social sharing image: the cover from Settings › Brand.
      imageUrl: org.coverUrl,
      // Spec 049: theme favicon ?? square logo ?? null (platform default).
      faviconUrl: await faviconUrlFor(org),
    };
  }

  /**
   * Get public organization info with published events.
   * A private storefront (Online Store › Preferences) without a valid
   * X-Storefront-Access token returns `locked: true`, the visitor message and
   * no events; branding stays so the password page can be styled.
   */
  async getPublicOrganization(identifier, { accessToken = null } = {}) {
    const org = await findByPublicIdentifier(prisma.organization, identifier, {
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        slug: true,
        name: true,
        slug: true,
        logoUrl: true,
        coverUrl: true,
        brandColor: true,
        themeMode: true,
        ...BRAND_IDENTITY_SELECT,
        storefrontPrivate: true,
        storefrontPasswordHash: true,
        storefrontMessage: true,
        buyerSignInLinks: true,
        buyerSignInMethod: true,
        themesEnabled: true,
        venues: { select: { events: PUBLIC_EVENTS_QUERY } },
      },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const organization = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      // Theme logo image + widths (account pages, legacy views): header matches the themed pages.
      storefrontLogo: await storefrontLogoFor(org),
      coverUrl: org.coverUrl,
      brandColor: org.brandColor,
      themeMode: org.themeMode,
      squareLogoUrl: org.squareLogoUrl,
      brandSecondaryColor: org.brandSecondaryColor,
      slogan: org.slogan,
      shortDescription: org.shortDescription,
      socialLinks: org.socialLinks,
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

  /** Set or clear the square logo (spec 049: favicon, social avatars). */
  async setOrganizationSquareLogo(id, squareLogoUrl, imageId) {
    const existing = await prisma.organization.findUnique({
      where: { id },
      select: { squareLogoImageId: true },
    });
    if (!existing) throw new NotFoundError('Organization not found');

    const organization = await prisma.organization.update({
      where: { id },
      data: { squareLogoUrl, squareLogoImageId: imageId },
    });

    logger.info('Organization square logo updated', {
      event: 'organization_square_logo_updated',
      organizationId: id,
      removed: squareLogoUrl === null,
    });

    return { organization, previousSquareLogoImageId: existing.squareLogoImageId };
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
