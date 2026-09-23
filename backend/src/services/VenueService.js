// Venue Service
// CRUD operations for venues scoped to organizations per FR-049, FR-010

import { prisma } from '@jump/db';
import logger from '../utils/logger.js';
import { ConflictError, NotFoundError } from '../middleware/errorHandler.js';
import { formatEventSummary } from '../utils/eventSummary.js';
import taxService from './TaxService.js';
import { rethrowSlugConflict, resolveUniqueSlug } from '../utils/slug.js';
import { findByPublicIdentifier } from '../utils/publicIdentifier.js';
import { resolveVenueTimeZone, DEFAULT_ZONE } from '../utils/usTimeZones.js';

class VenueService {
  /**
   * The zone a venue falls back to when its address says nothing — no postal
   * code yet, or a non-US country.
   *
   * Spec 021 adds `Organization.timezone` as the store's own zone; when it
   * lands, read it here and this stays the only place that decides
   * (spec 033 §9.4). Until then every organization falls back to Eastern, which
   * is what the schema default has always been.
   */
  defaultTimeZoneFor(_organization) {
    return DEFAULT_ZONE;
  }

  /**
   * Spec 033 phase 2: work out a venue's zone and where it came from.
   *
   * An explicit `timezone` in the request is the organizer's own choice and is
   * always MANUAL — it is never re-derived by a later address edit. Otherwise
   * the address decides; when it cannot, the row keeps the fallback and stays
   * DEFAULT so a later edit can still resolve it.
   */
  _resolveTimeZone(data, { organization = null } = {}) {
    if (data.timezone) return { timezone: data.timezone, timezoneSource: 'MANUAL' };

    const derived = resolveVenueTimeZone({
      country: data.country,
      state: data.state,
      postalCode: data.postalCode,
    });
    if (derived.timezone) return { timezone: derived.timezone, timezoneSource: 'DERIVED' };

    return { timezone: this.defaultTimeZoneFor(organization), timezoneSource: 'DEFAULT' };
  }

  /** Create a new venue within an organization. */
  async createVenue(orgId, data) {
    const slugState = await resolveUniqueSlug(prisma.venue, {
      title: data.name,
      customSlug: data.slug,
    });
    let venue;
    try {
      venue = await prisma.venue.create({
        data: {
          organizationId: orgId,
          name: data.name,
          ...slugState,
          address: data.address,
          city: data.city || null,
          state: data.state || null,
          postalCode: data.postalCode || null,
          country: data.country || 'US',
          ...this._resolveTimeZone(data),
          isPublic: data.isPublic !== undefined ? data.isPublic : true,
        },
      });
    } catch (error) {
      rethrowSlugConflict(error);
    }

    logger.info('Venue created', {
      event: 'venue_created',
      venueId: venue.id,
      organizationId: orgId,
      name: venue.name,
    });

    return venue;
  }

  /** Get venue by ID, scoped to organization. */
  async getVenueById(orgId, id) {
    return prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      include: {
        _count: {
          select: { events: true },
        },
      },
    });
  }

  /** Get public venue fields and published event summaries. */
  async getPublicVenueById(identifier) {
    const venue = await findByPublicIdentifier(prisma.venue, identifier, {
      where: {
        isPublic: true,
        organization: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        address: true,
        timezone: true,
        logoUrl: true,
        organization: { select: { id: true, slug: true, brandColor: true, themeMode: true } },
        events: {
          where: { status: 'PUBLISHED' },
          orderBy: { date: 'asc' },
          select: {
            id: true,
            slug: true,
            name: true,
            date: true,
            category: true,
            status: true,
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
    });

    if (!venue) {
      throw new NotFoundError('Venue not found');
    }

    const publicVenue = {
      id: venue.id,
      slug: venue.slug,
      name: venue.name,
      slug: venue.slug,
      address: venue.address,
      timezone: venue.timezone,
      logoUrl: venue.logoUrl,
      brandColor: venue.organization?.brandColor || null,
      themeMode: venue.organization?.themeMode || 'SYSTEM',
      organizationId: venue.organization?.id || null,
      organizationSlug: venue.organization?.slug || null,
    };
    const eventVenue = {
      id: venue.id,
      slug: venue.slug,
      name: venue.name,
      slug: venue.slug,
      address: venue.address,
      timezone: venue.timezone,
    };

    return {
      venue: publicVenue,
      events: venue.events.map((event) =>
        formatEventSummary({ ...event, venue: eventVenue })
      ),
    };
  }

  /** Canonical public route data; intentionally bypasses the private-store gate. */
  async getPublicRoute(identifier) {
    const venue = await findByPublicIdentifier(prisma.venue, identifier, {
      where: { isPublic: true, organization: { status: 'ACTIVE' } },
      select: { id: true, slug: true },
    });
    if (!venue) throw new NotFoundError('Venue not found');
    return venue;
  }

  /** List venues for an organization. */
  async listVenuesByOrganization(orgId) {
    return prisma.venue.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { events: true },
        },
      },
    });
  }

  /** Update venue metadata after verifying organization ownership. */
  async updateVenue(orgId, id, data) {
    const existing = await prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      // country / postalCode / state / timezoneSource feed the spec 033 re-derive rule.
      select: {
        id: true,
        name: true,
        slug: true,
        slugCustomized: true,
        country: true,
        state: true,
        postalCode: true,
        timezoneSource: true,
      },
    });
    if (!existing) {
      throw new NotFoundError('Venue not found');
    }

    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.name !== undefined || data.slug !== undefined) {
      Object.assign(
        updateData,
        await resolveUniqueSlug(prisma.venue, {
          title: data.name ?? existing.name,
          customSlug: data.slug,
          currentSlug: existing.slug,
          slugCustomized: existing.slugCustomized,
          exceptId: id,
        })
      );
    }
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;

    // Spec 033 phase 2. An explicit zone is the organizer's choice and sticks.
    // Otherwise an address change re-derives — but only for a venue whose zone
    // was never chosen by hand, so a MANUAL override is not silently undone.
    const clearingOverride = data.timezone === null;
    if (data.timezone) {
      updateData.timezone = data.timezone;
      updateData.timezoneSource = 'MANUAL';
    } else if (
      clearingOverride ||
      (existing.timezoneSource !== 'MANUAL' &&
        (data.state !== undefined || data.postalCode !== undefined || data.country !== undefined))
    ) {
      const derived = resolveVenueTimeZone({
        country: data.country ?? existing.country,
        state: data.state ?? existing.state,
        postalCode: data.postalCode ?? existing.postalCode,
      });
      if (derived.timezone) {
        updateData.timezone = derived.timezone;
        updateData.timezoneSource = 'DERIVED';
      } else if (clearingOverride) {
        // Nothing to derive from any more: fall back and let a later edit resolve it.
        updateData.timezone = this.defaultTimeZoneFor(null);
        updateData.timezoneSource = 'DEFAULT';
      }
    }

    let venue;
    try {
      venue = await prisma.venue.update({ where: { id }, data: updateData });
    } catch (error) {
      rethrowSlugConflict(error);
    }

    logger.info('Venue updated', {
      event: 'venue_updated',
      venueId: venue.id,
      organizationId: orgId,
      changes: Object.keys(updateData),
    });

    // Tax rates are cached per event from the venue's state + postal code
    // (spec 009); a location change must refresh upcoming events.
    if (updateData.state !== undefined || updateData.postalCode !== undefined) {
      await this._refreshEventTaxRates(venue);
    }

    return venue;
  }

  /** Set or clear a venue logo after verifying organization ownership. */
  async setVenueLogo(orgId, id, logoUrl, imageId) {
    const existing = await prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      select: { logoUrl: true, imageId: true },
    });
    if (!existing) {
      throw new NotFoundError('Venue not found');
    }

    const data = { logoUrl };
    if (imageId !== undefined) data.imageId = imageId;

    const venue = await prisma.venue.update({ where: { id }, data });

    logger.info('Venue logo updated', {
      event: 'venue_logo_updated',
      venueId: id,
      organizationId: orgId,
      removed: logoUrl === null,
    });

    return { venue, previousLogoUrl: existing.logoUrl };
  }

  /** Delete a venue unless linked events exist. */
  async deleteVenue(orgId, id) {
    const existing = await prisma.venue.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError('Venue not found');
    }

    const eventCount = await prisma.event.count({
      where: { venueId: id, venue: { organizationId: orgId } },
    });

    if (eventCount > 0) {
      throw new ConflictError(
        `Cannot delete venue — ${eventCount} event(s) are linked to this venue`
      );
    }

    await prisma.venue.delete({ where: { id } });

    logger.info('Venue deleted', {
      event: 'venue_deleted',
      venueId: id,
      organizationId: orgId,
    });
  }

  /** Recompute the cached tax rate on the venue's upcoming events. Never throws. */
  async _refreshEventTaxRates(venue) {
    try {
      const events = await prisma.event.findMany({
        where: { venueId: venue.id, status: { in: ['DRAFT', 'PUBLISHED'] }, date: { gte: new Date() } },
        select: { id: true, taxRate: true },
      });
      if (events.length === 0) return;
      // One lookup — every event at this venue shares the same location.
      const result = await taxService.rateForVenue(venue.organizationId, venue);
      // A failed Stripe lookup keeps any good cached rate (same rule as EventService).
      const targets = events.filter((e) => !taxService.shouldKeepCachedRate(e, result));
      if (targets.length < events.length) {
        logger.warn('Tax rate lookup failed; keeping cached rates', {
          event: 'tax_rate_refresh_kept_previous',
          venueId: venue.id,
          kept: events.length - targets.length,
          error: result.error,
        });
      }
      if (targets.length === 0) return;
      await prisma.event.updateMany({
        where: { id: { in: targets.map((e) => e.id) } },
        data: { taxRate: result.rate, taxRateSource: result.source },
      });
    } catch (error) {
      logger.error('Failed to refresh event tax rates after venue change', {
        event: 'venue_tax_refresh_failed',
        venueId: venue.id,
        error: error.message,
      });
    }
  }
}

export default new VenueService();
