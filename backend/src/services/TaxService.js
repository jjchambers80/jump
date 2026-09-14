// Tax Service (spec 009)
// Per-organization tax regions decide whether tax is collected for a venue and
// by which source (Stripe Tax lookup or a manual rate). The effective rate is
// still computed once per event and cached on Event.taxRate.

import { prisma } from '@jump/db';
import stripe from '../config/stripe.js';
import logger from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { US_STATES, stateName } from '../utils/usStates.js';

// Stripe product tax code for general event admissions
const ADMISSIONS_TAX_CODE = 'txcd_20060057';
// Stripe Tax status + registrations change rarely; one call per 5 minutes is plenty.
const SERVICE_STATUS_TTL_MS = 5 * 60 * 1000;
const STRIPE_TAX_DASHBOARD_URL = 'https://dashboard.stripe.com/settings/tax';

export class StripeTaxError extends Error {
  constructor(message, { reason = null, cause = null } = {}) {
    super(message);
    this.name = 'StripeTaxError';
    this.reason = reason;
    this.cause = cause;
  }
}

class TaxService {
  constructor() {
    this._statusCache = { value: null, expiresAt: 0 };
  }

  // ---------------------------------------------------------------------------
  // Regions
  // ---------------------------------------------------------------------------

  /**
   * Region key for a venue: US state code. Null when the venue has no usable state.
   * @returns {{ country: string, region: string } | null}
   */
  resolveRegionForVenue(venue) {
    const state = typeof venue?.state === 'string' ? venue.state.trim().toUpperCase() : '';
    if (!US_STATES[state]) return null;
    return { country: 'US', region: state };
  }

  /**
   * Settings page payload: every region the organization has a venue in, joined
   * to its TaxRegion row (or "not set"), plus venues that cannot be placed.
   */
  async listRegions(orgId) {
    const [venues, rows, service, upcoming] = await Promise.all([
      prisma.venue.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, state: true, postalCode: true },
        orderBy: { name: 'asc' },
      }),
      prisma.taxRegion.findMany({ where: { organizationId: orgId } }),
      this.getServiceStatus(),
      this._upcomingEventsByState(orgId),
    ]);

    const byKey = new Map(rows.map((r) => [`${r.country}/${r.region}`, r]));
    const venuesByKey = new Map();
    const needsAddress = [];
    for (const venue of venues) {
      const key = this.resolveRegionForVenue(venue);
      if (!key) {
        needsAddress.push({ id: venue.id, name: venue.name });
        continue;
      }
      const k = `${key.country}/${key.region}`;
      if (!venuesByKey.has(k)) venuesByKey.set(k, []);
      venuesByKey.get(k).push(venue);
    }
    // Configured regions with no venues still show so the org can see/clear them.
    for (const k of byKey.keys()) if (!venuesByKey.has(k)) venuesByKey.set(k, []);

    const registered = new Set(service.registrations.map((r) => `${r.country}/${r.region}`));
    const regions = [...venuesByKey.entries()]
      .map(([k, regionVenues]) => {
        const [country, region] = k.split('/');
        const row = byKey.get(k) || null;
        return this._formatRegion(country, region, row, regionVenues.length, registered.has(k), upcoming.get(region) || 0);
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { regions, needsAddress };
  }

  /**
   * Create or update the organization's setting for one region, then refresh
   * the cached rate on that region's upcoming events.
   */
  async upsertRegion(orgId, country, region, { collecting, source, manualRate }) {
    if (country !== 'US') throw new ValidationError('Only US regions are supported');
    if (!US_STATES[region]) throw new ValidationError('Region must be a two-letter US state code');

    const data = {
      collecting: Boolean(collecting),
      source: source || 'STRIPE',
      manualRate: source === 'MANUAL' ? manualRate : null,
    };
    const row = await prisma.taxRegion.upsert({
      where: { organizationId_country_region: { organizationId: orgId, country, region } },
      create: { organizationId: orgId, country, region, ...data },
      update: data,
    });

    logger.info('Tax region updated', {
      event: 'tax_region_updated',
      orgId,
      country,
      region,
      collecting: row.collecting,
      source: row.source,
      manualRate: row.manualRate ? Number(row.manualRate) : null,
    });

    const recalculatedEvents = await this.recalculateEvents(orgId, country, region);
    return { region: await this._regionResponse(orgId, row.id, country, region), recalculatedEvents };
  }

  /**
   * Re-run the rate lookup for a configured region's upcoming events on demand
   * ("Recalculate now" on Settings › Tax). Phase 2.
   */
  async recalculateRegion(orgId, country, region) {
    const row = await prisma.taxRegion.findUnique({
      where: { organizationId_country_region: { organizationId: orgId, country, region } },
    });
    if (!row) throw new NotFoundError('Tax region is not configured');
    const recalculatedEvents = await this.recalculateEvents(orgId, country, region);
    logger.info('Tax region recalculated', { event: 'tax_region_recalculated', orgId, country, region, recalculatedEvents });
    return { region: await this._regionResponse(orgId, row.id, country, region), recalculatedEvents };
  }

  /** Fresh region row for a write response (after lookups may have updated it). */
  async _regionResponse(orgId, rowId, country, region) {
    const [fresh, service, venueCount, upcoming] = await Promise.all([
      prisma.taxRegion.findUnique({ where: { id: rowId } }),
      this.getServiceStatus(),
      prisma.venue.count({ where: { organizationId: orgId, state: region } }),
      this._upcomingEventsByState(orgId),
    ]);
    const registered = service.registrations.some((r) => r.country === country && r.region === region);
    return this._formatRegion(country, region, fresh, venueCount, registered, upcoming.get(region) || 0);
  }

  /**
   * Re-run the rate lookup for every upcoming DRAFT/PUBLISHED event whose venue
   * is in the region. Orders already placed keep the amounts they were charged.
   * @returns {Promise<number>} events updated
   */
  async recalculateEvents(orgId, country, region) {
    const events = await prisma.event.findMany({
      where: {
        status: { in: ['DRAFT', 'PUBLISHED'] },
        date: { gte: new Date() },
        venue: { organizationId: orgId, state: region },
      },
      include: { venue: true },
    });
    let updated = 0;
    for (const event of events) {
      const { rate, source } = await this.rateForVenue(orgId, event.venue);
      await prisma.event.update({ where: { id: event.id }, data: { taxRate: rate, taxRateSource: source } });
      updated += 1;
    }
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Organization-level settings and the collected tax report (phase 3)
  // ---------------------------------------------------------------------------

  async getTaxSettings(orgId) {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { taxInclusivePricing: true } });
    if (!org) throw new NotFoundError('Organization not found');
    return { taxInclusivePricing: org.taxInclusivePricing };
  }

  /**
   * Flip tax-inclusive pricing. Cached event rates do not change — only how
   * FeeService applies them at checkout — so nothing needs recalculating.
   */
  async updateTaxSettings(orgId, { taxInclusivePricing }) {
    const org = await prisma.organization.update({
      where: { id: orgId },
      data: { taxInclusivePricing: Boolean(taxInclusivePricing) },
      select: { taxInclusivePricing: true },
    });
    logger.info('Tax settings updated', { event: 'tax_settings_updated', orgId, taxInclusivePricing: org.taxInclusivePricing });
    return { taxInclusivePricing: org.taxInclusivePricing };
  }

  /**
   * Tax collected per region for orders placed in [from, to]. Refunded tax is
   * estimated proportionally (refund ÷ order total × order tax) because
   * refunds do not store a tax split.
   *
   * @returns {Promise<{ from: string, to: string, rows: Array, totals: Object }>}
   */
  async collectedReport(orgId, { from, to }) {
    const orders = await prisma.order.findMany({
      where: {
        status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
        createdAt: { gte: from, lte: to },
        event: { venue: { organizationId: orgId } },
      },
      select: {
        id: true,
        subtotalAmount: true,
        taxAmount: true,
        totalAmount: true,
        event: { select: { venue: { select: { state: true } } } },
        refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
      },
    });

    const byRegion = new Map();
    for (const order of orders) {
      const region = this.resolveRegionForVenue(order.event.venue)?.region || null;
      const key = region || '—';
      if (!byRegion.has(key)) {
        byRegion.set(key, { region, name: region ? stateName(region) : 'No state', orders: 0, taxableSales: 0, taxCollected: 0, taxRefunded: 0 });
      }
      const row = byRegion.get(key);
      const total = Number(order.totalAmount);
      const tax = Number(order.taxAmount);
      const refunded = order.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
      row.orders += 1;
      row.taxableSales += Number(order.subtotalAmount);
      row.taxCollected += tax;
      row.taxRefunded += total > 0 ? (refunded / total) * tax : 0;
    }

    const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const rows = [...byRegion.values()]
      .map((r) => ({ ...r, taxableSales: round(r.taxableSales), taxCollected: round(r.taxCollected), taxRefunded: round(r.taxRefunded), taxNet: round(r.taxCollected - r.taxRefunded) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const totals = rows.reduce(
      (t, r) => ({
        orders: t.orders + r.orders,
        taxableSales: round(t.taxableSales + r.taxableSales),
        taxCollected: round(t.taxCollected + r.taxCollected),
        taxRefunded: round(t.taxRefunded + r.taxRefunded),
        taxNet: round(t.taxNet + r.taxNet),
      }),
      { orders: 0, taxableSales: 0, taxCollected: 0, taxRefunded: 0, taxNet: 0 }
    );
    return { from: from.toISOString(), to: to.toISOString(), rows, totals };
  }

  /** CSV rendering of collectedReport() for download. */
  reportToCsv(report) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Region', 'State', 'Orders', 'Taxable sales', 'Tax collected', 'Tax refunded (est.)', 'Tax net'].map(esc).join(',')];
    for (const r of report.rows) {
      lines.push([r.name, r.region || '', r.orders, r.taxableSales.toFixed(2), r.taxCollected.toFixed(2), r.taxRefunded.toFixed(2), r.taxNet.toFixed(2)].map(esc).join(','));
    }
    const t = report.totals;
    lines.push(['Total', '', t.orders, t.taxableSales.toFixed(2), t.taxCollected.toFixed(2), t.taxRefunded.toFixed(2), t.taxNet.toFixed(2)].map(esc).join(','));
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------------------
  // Rate resolution
  // ---------------------------------------------------------------------------

  /**
   * Effective rate for a venue under its organization's region setting.
   * Records the outcome (rate or error) on the TaxRegion row for the settings page.
   *
   * @returns {Promise<{ rate: number, source: 'STRIPE'|'MANUAL'|null, error: string|null }>}
   */
  async rateForVenue(orgId, venue) {
    const key = this.resolveRegionForVenue(venue);
    if (!key) return { rate: 0, source: null, error: 'Venue has no US state' };

    const row = await prisma.taxRegion.findUnique({
      where: { organizationId_country_region: { organizationId: orgId, ...key } },
    });
    if (!row || !row.collecting) return { rate: 0, source: null, error: null };

    if (row.source === 'MANUAL') {
      const rate = Number(row.manualRate || 0);
      await this._recordLookup(row.id, { rate, source: 'MANUAL', error: null });
      return { rate, source: 'MANUAL', error: null };
    }

    try {
      const rate = await this.getTaxRateForVenue(venue.postalCode, key.country);
      await this._recordLookup(row.id, { rate, source: 'STRIPE', error: null });
      return { rate, source: 'STRIPE', error: null };
    } catch (error) {
      const message =
        error instanceof StripeTaxError && error.reason === 'not_collecting'
          ? `No Stripe Tax registration for ${stateName(key.region)}`
          : error.message;
      await this._recordLookup(row.id, { rate: null, source: 'STRIPE', error: message });
      return { rate: 0, source: 'STRIPE', error: message };
    }
  }

  /**
   * Look up the effective tax rate for a venue location via Stripe Tax.
   * Creates a calculation with a $100 reference line and derives the rate.
   * Throws StripeTaxError on any failure — callers decide what 0 means.
   *
   * @param {string} postalCode - Venue postal code
   * @param {string} [country='US'] - ISO country code
   * @returns {Promise<number>} Effective rate as a decimal (0.08875 for 8.875%)
   */
  async getTaxRateForVenue(postalCode, country = 'US') {
    if (!postalCode) throw new StripeTaxError('Venue has no postal code', { reason: 'no_postal_code' });

    const referenceAmountCents = 10000;
    let calculation;
    try {
      calculation = await stripe.tax.calculations.create({
        currency: 'usd',
        customer_details: {
          address: { country, postal_code: postalCode },
          address_source: 'shipping', // venue location = where the service is delivered
        },
        line_items: [
          {
            amount: referenceAmountCents,
            reference: 'tax_rate_lookup',
            tax_behavior: 'exclusive',
            tax_code: ADMISSIONS_TAX_CODE,
          },
        ],
      });
    } catch (error) {
      logger.error('Stripe Tax calculation failed', {
        event: 'tax_rate_error',
        postalCode,
        country,
        error: error.message,
      });
      throw new StripeTaxError(`Stripe Tax lookup failed: ${error.message}`, { reason: 'stripe_error', cause: error });
    }

    const taxRate = calculation.tax_amount_exclusive / referenceAmountCents;
    const reasons = (calculation.tax_breakdown || []).map((b) => b.taxability_reason);
    if (taxRate === 0 && reasons.includes('not_collecting')) {
      throw new StripeTaxError('Stripe Tax is not collecting in this jurisdiction', { reason: 'not_collecting' });
    }

    logger.info('Tax rate computed', {
      event: 'tax_rate_computed',
      postalCode,
      country,
      taxRate,
      stripeTaxCalculationId: calculation.id,
    });
    return taxRate;
  }

  // ---------------------------------------------------------------------------
  // Stripe Tax service status
  // ---------------------------------------------------------------------------

  /**
   * Whether Stripe Tax is usable on the platform account and where it is registered.
   * Cached in-process for 5 minutes. Never throws: failures report `unavailable`.
   *
   * @returns {Promise<{ provider: 'STRIPE_TAX', status: 'active'|'pending'|'unavailable', registrations: Array<{country: string, region: string|null}>, manageUrl: string, error: string|null }>}
   */
  async getServiceStatus() {
    const now = Date.now();
    if (this._statusCache.value && this._statusCache.expiresAt > now) return this._statusCache.value;

    let value;
    try {
      const [settings, registrations] = await Promise.all([
        stripe.tax.settings.retrieve(),
        stripe.tax.registrations.list({ status: 'active', limit: 100 }),
      ]);
      value = {
        provider: 'STRIPE_TAX',
        status: settings.status === 'active' ? 'active' : 'pending',
        registrations: registrations.data.map((r) => ({
          country: r.country,
          region: r.country_options?.us?.state || null,
        })),
        manageUrl: STRIPE_TAX_DASHBOARD_URL,
        error: null,
      };
    } catch (error) {
      logger.warn('Stripe Tax status unavailable', { event: 'tax_status_unavailable', error: error.message });
      value = { provider: 'STRIPE_TAX', status: 'unavailable', registrations: [], manageUrl: STRIPE_TAX_DASHBOARD_URL, error: error.message };
    }
    this._statusCache = { value, expiresAt: now + SERVICE_STATUS_TTL_MS };
    return value;
  }

  /** Drop the cached service status (tests). */
  _invalidate() {
    this._statusCache = { value: null, expiresAt: 0 };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  async _recordLookup(regionId, { rate, source, error }) {
    try {
      await prisma.taxRegion.update({
        where: { id: regionId },
        data: { lastRate: rate, lastSource: source, lastCheckedAt: new Date(), lastError: error },
      });
    } catch (err) {
      logger.warn('Could not record tax lookup outcome', { event: 'tax_lookup_record_failed', regionId, error: err.message });
    }
  }

  /** Upcoming DRAFT/PUBLISHED events per venue state — what a region save would recalculate. */
  async _upcomingEventsByState(orgId) {
    const events = await prisma.event.findMany({
      where: { status: { in: ['DRAFT', 'PUBLISHED'] }, date: { gte: new Date() }, venue: { organizationId: orgId } },
      select: { venue: { select: { state: true } } },
    });
    const counts = new Map();
    for (const e of events) {
      const key = this.resolveRegionForVenue(e.venue)?.region;
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  _formatRegion(country, region, row, venueCount, registrationFound, upcomingEventCount = 0) {
    return {
      country,
      region,
      name: stateName(region),
      venueCount,
      upcomingEventCount,
      configured: Boolean(row),
      collecting: row ? row.collecting : false,
      source: row ? row.source : null,
      manualRate: row?.manualRate != null ? Number(row.manualRate) : null,
      registrationFound,
      lastRate: row?.lastRate != null ? Number(row.lastRate) : null,
      lastSource: row?.lastSource || null,
      lastCheckedAt: row?.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
      lastError: row?.lastError || null,
    };
  }
}

export default new TaxService();
