// Unit tests for TaxService (spec 009): region resolution, rate resolution by
// source, Stripe failure handling, service status — Prisma and Stripe mocked.

import { jest } from '@jest/globals';

const taxRegion = { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() };
const venue = { findMany: jest.fn(), count: jest.fn() };
const event = { findMany: jest.fn(), update: jest.fn() };
jest.unstable_mockModule('@jump/db', () => ({ prisma: { taxRegion, venue, event } }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const stripe = {
  tax: {
    calculations: { create: jest.fn() },
    settings: { retrieve: jest.fn() },
    registrations: { list: jest.fn() },
  },
};
jest.unstable_mockModule('../../src/config/stripe.js', () => ({ default: stripe, stripe }));

const { default: service, StripeTaxError } = await import('../../src/services/TaxService.js');

const ncVenue = { id: 'ven-1', name: 'Arena', state: 'NC', postalCode: '27601' };
const row = (extra = {}) => ({
  id: 'reg-1',
  organizationId: 'org-1',
  country: 'US',
  region: 'NC',
  collecting: true,
  source: 'STRIPE',
  manualRate: null,
  lastRate: null,
  lastSource: null,
  lastCheckedAt: null,
  lastError: null,
  ...extra,
});
const calculation = (taxCents, reasons = ['standard_rated']) => ({
  id: 'taxcalc_1',
  tax_amount_exclusive: taxCents,
  tax_breakdown: reasons.map((taxability_reason) => ({ taxability_reason })),
});
const activeStatus = () => {
  stripe.tax.settings.retrieve.mockResolvedValue({ status: 'active' });
  stripe.tax.registrations.list.mockResolvedValue({ data: [{ country: 'US', country_options: { us: { state: 'NC' } } }] });
};

describe('TaxService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service._invalidate();
    taxRegion.update.mockResolvedValue({});
  });

  describe('resolveRegionForVenue', () => {
    it('keys US venues by their two-letter state', () => {
      expect(service.resolveRegionForVenue(ncVenue)).toEqual({ country: 'US', region: 'NC' });
      expect(service.resolveRegionForVenue({ state: ' nc ' })).toEqual({ country: 'US', region: 'NC' });
    });

    it('returns null for venues without a usable state', () => {
      expect(service.resolveRegionForVenue({ state: null })).toBeNull();
      expect(service.resolveRegionForVenue({ state: 'Somewhere' })).toBeNull();
      expect(service.resolveRegionForVenue(undefined)).toBeNull();
    });
  });

  describe('rateForVenue', () => {
    it('is 0 with no source when the region is not configured', async () => {
      taxRegion.findUnique.mockResolvedValue(null);
      await expect(service.rateForVenue('org-1', ncVenue)).resolves.toEqual({ rate: 0, source: null, error: null });
      expect(stripe.tax.calculations.create).not.toHaveBeenCalled();
    });

    it('is 0 with no source when the region is not collecting', async () => {
      taxRegion.findUnique.mockResolvedValue(row({ collecting: false }));
      await expect(service.rateForVenue('org-1', ncVenue)).resolves.toEqual({ rate: 0, source: null, error: null });
    });

    it('reports venues without a state instead of guessing', async () => {
      const result = await service.rateForVenue('org-1', { ...ncVenue, state: null });
      expect(result).toEqual({ rate: 0, source: null, error: 'Venue has no US state' });
      expect(taxRegion.findUnique).not.toHaveBeenCalled();
    });

    it('uses the manual rate without calling Stripe and records the lookup', async () => {
      taxRegion.findUnique.mockResolvedValue(row({ source: 'MANUAL', manualRate: '0.05300' }));
      await expect(service.rateForVenue('org-1', ncVenue)).resolves.toEqual({ rate: 0.053, source: 'MANUAL', error: null });
      expect(stripe.tax.calculations.create).not.toHaveBeenCalled();
      expect(taxRegion.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'reg-1' }, data: expect.objectContaining({ lastRate: 0.053, lastSource: 'MANUAL', lastError: null }) })
      );
    });

    it('derives the Stripe Tax rate from a $100 reference calculation', async () => {
      taxRegion.findUnique.mockResolvedValue(row());
      stripe.tax.calculations.create.mockResolvedValue(calculation(825));
      await expect(service.rateForVenue('org-1', ncVenue)).resolves.toEqual({ rate: 0.0825, source: 'STRIPE', error: null });
      expect(stripe.tax.calculations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_details: { address: { country: 'US', postal_code: '27601' }, address_source: 'shipping' },
          line_items: [expect.objectContaining({ amount: 10000, tax_code: 'txcd_20060057', tax_behavior: 'exclusive' })],
        })
      );
      expect(taxRegion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastRate: 0.0825, lastSource: 'STRIPE', lastError: null }) })
      );
    });

    it('records a Stripe failure on the region and returns 0 with the error', async () => {
      taxRegion.findUnique.mockResolvedValue(row());
      stripe.tax.calculations.create.mockRejectedValue(new Error('Invalid API Key provided'));
      const result = await service.rateForVenue('org-1', ncVenue);
      expect(result).toEqual({ rate: 0, source: 'STRIPE', error: 'Stripe Tax lookup failed: Invalid API Key provided' });
      expect(taxRegion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastRate: null, lastError: 'Stripe Tax lookup failed: Invalid API Key provided' }) })
      );
    });

    it('explains a 0% "not_collecting" result as a missing registration', async () => {
      taxRegion.findUnique.mockResolvedValue(row());
      stripe.tax.calculations.create.mockResolvedValue(calculation(0, ['not_collecting']));
      const result = await service.rateForVenue('org-1', ncVenue);
      expect(result).toEqual({ rate: 0, source: 'STRIPE', error: 'No Stripe Tax registration for North Carolina' });
    });

    it('keeps a genuine 0% (tax-exempt jurisdiction) as a successful lookup', async () => {
      taxRegion.findUnique.mockResolvedValue(row());
      stripe.tax.calculations.create.mockResolvedValue(calculation(0, ['not_subject_to_tax']));
      await expect(service.rateForVenue('org-1', ncVenue)).resolves.toEqual({ rate: 0, source: 'STRIPE', error: null });
    });

    it('treats a missing postal code as a lookup error, not 0%', async () => {
      taxRegion.findUnique.mockResolvedValue(row());
      const result = await service.rateForVenue('org-1', { ...ncVenue, postalCode: null });
      expect(result).toMatchObject({ rate: 0, source: 'STRIPE', error: 'Venue has no postal code' });
      expect(stripe.tax.calculations.create).not.toHaveBeenCalled();
    });
  });

  describe('getTaxRateForVenue', () => {
    it('throws StripeTaxError instead of swallowing failures', async () => {
      stripe.tax.calculations.create.mockRejectedValue(new Error('boom'));
      await expect(service.getTaxRateForVenue('27601')).rejects.toBeInstanceOf(StripeTaxError);
      await expect(service.getTaxRateForVenue('')).rejects.toMatchObject({ reason: 'no_postal_code' });
    });
  });

  describe('getServiceStatus', () => {
    it('reports active with US state registrations and caches the answer', async () => {
      activeStatus();
      const first = await service.getServiceStatus();
      expect(first).toMatchObject({ provider: 'STRIPE_TAX', status: 'active', registrations: [{ country: 'US', region: 'NC' }], error: null });
      expect(first.manageUrl).toMatch(/^https:\/\/dashboard\.stripe\.com\//);
      await service.getServiceStatus();
      expect(stripe.tax.settings.retrieve).toHaveBeenCalledTimes(1);
      expect(stripe.tax.registrations.list).toHaveBeenCalledWith({ status: 'active', limit: 100 });
    });

    it('reports pending when Stripe Tax is not activated', async () => {
      stripe.tax.settings.retrieve.mockResolvedValue({ status: 'pending' });
      stripe.tax.registrations.list.mockResolvedValue({ data: [] });
      await expect(service.getServiceStatus()).resolves.toMatchObject({ status: 'pending', registrations: [] });
    });

    it('reports unavailable and never throws when Stripe is unreachable', async () => {
      stripe.tax.settings.retrieve.mockRejectedValue(new Error('No such API key'));
      stripe.tax.registrations.list.mockResolvedValue({ data: [] });
      await expect(service.getServiceStatus()).resolves.toMatchObject({ status: 'unavailable', error: 'No such API key' });
    });
  });

  describe('listRegions', () => {
    it('derives regions from venues, joins settings, and buckets venues without a state', async () => {
      activeStatus();
      venue.findMany.mockResolvedValue([
        { id: 'v1', name: 'Arena', state: 'NC', postalCode: '27601' },
        { id: 'v2', name: 'Club', state: 'NC', postalCode: '28202' },
        { id: 'v3', name: 'Hall', state: 'TX', postalCode: '73301' },
        { id: 'v4', name: 'Garden', state: null, postalCode: null },
      ]);
      taxRegion.findMany.mockResolvedValue([
        row(),
        row({ id: 'reg-2', region: 'VA', source: 'MANUAL', manualRate: '0.05300', lastRate: '0.05300', lastSource: 'MANUAL', lastCheckedAt: new Date('2026-09-12T00:00:00Z') }),
      ]);
      event.findMany.mockResolvedValue([{ venue: { state: 'NC' } }, { venue: { state: 'NC' } }, { venue: { state: 'TX' } }, { venue: { state: null } }]);

      const { regions, needsAddress } = await service.listRegions('org-1');

      expect(regions.map((r) => r.region)).toEqual(['NC', 'TX', 'VA']);
      expect(regions[0]).toMatchObject({ name: 'North Carolina', venueCount: 2, upcomingEventCount: 2, configured: true, collecting: true, source: 'STRIPE', registrationFound: true });
      expect(regions[1]).toMatchObject({ name: 'Texas', venueCount: 1, upcomingEventCount: 1, configured: false, collecting: false, source: null, registrationFound: false });
      expect(regions[2]).toMatchObject({ name: 'Virginia', venueCount: 0, upcomingEventCount: 0, configured: true, source: 'MANUAL', manualRate: 0.053, lastRate: 0.053, lastCheckedAt: '2026-09-12T00:00:00.000Z' });
      expect(needsAddress).toEqual([{ id: 'v4', name: 'Garden' }]);
    });
  });

  describe('upsertRegion', () => {
    it('saves the setting, recalculates upcoming events in the region, and returns the row', async () => {
      activeStatus();
      taxRegion.upsert.mockResolvedValue(row({ source: 'MANUAL', manualRate: '0.05000' }));
      taxRegion.findUnique.mockResolvedValue(row({ source: 'MANUAL', manualRate: '0.05000' }));
      venue.count.mockResolvedValue(2);
      event.findMany.mockResolvedValue([
        { id: 'evt-1', venue: ncVenue },
        { id: 'evt-2', venue: ncVenue },
      ]);
      event.update.mockResolvedValue({});

      const result = await service.upsertRegion('org-1', 'US', 'NC', { collecting: true, source: 'MANUAL', manualRate: 0.05 });

      expect(taxRegion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId_country_region: { organizationId: 'org-1', country: 'US', region: 'NC' } },
          create: expect.objectContaining({ collecting: true, source: 'MANUAL', manualRate: 0.05 }),
        })
      );
      expect(event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: { in: ['DRAFT', 'PUBLISHED'] }, venue: { organizationId: 'org-1', state: 'NC' } }) })
      );
      expect(event.update).toHaveBeenCalledTimes(2);
      expect(event.update).toHaveBeenCalledWith({ where: { id: 'evt-1' }, data: { taxRate: 0.05, taxRateSource: 'MANUAL' } });
      expect(result.recalculatedEvents).toBe(2);
      expect(result.region).toMatchObject({ region: 'NC', venueCount: 2, upcomingEventCount: 2, source: 'MANUAL', manualRate: 0.05, registrationFound: true });
    });

    it('clears the manual rate when switching back to Stripe Tax', async () => {
      activeStatus();
      taxRegion.upsert.mockResolvedValue(row());
      taxRegion.findUnique.mockResolvedValue(row());
      venue.count.mockResolvedValue(1);
      event.findMany.mockResolvedValue([]);
      await service.upsertRegion('org-1', 'US', 'NC', { collecting: true, source: 'STRIPE', manualRate: 0.05 });
      expect(taxRegion.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { collecting: true, source: 'STRIPE', manualRate: null } }));
    });

    it('recalculateRegion re-runs lookups for a configured region and 404s otherwise', async () => {
      activeStatus();
      taxRegion.findUnique.mockResolvedValue(row());
      venue.count.mockResolvedValue(1);
      event.findMany.mockResolvedValue([{ id: 'evt-1', venue: ncVenue }]);
      event.update.mockResolvedValue({});
      stripe.tax.calculations.create.mockResolvedValue(calculation(700));

      const result = await service.recalculateRegion('org-1', 'US', 'NC');
      expect(result.recalculatedEvents).toBe(1);
      expect(event.update).toHaveBeenCalledWith({ where: { id: 'evt-1' }, data: { taxRate: 0.07, taxRateSource: 'STRIPE' } });
      expect(taxRegion.upsert).not.toHaveBeenCalled();

      taxRegion.findUnique.mockResolvedValue(null);
      await expect(service.recalculateRegion('org-1', 'US', 'TX')).rejects.toThrow('not configured');
    });

    it('rejects non-US or unknown regions', async () => {
      await expect(service.upsertRegion('org-1', 'CA', 'ON', { collecting: true })).rejects.toThrow('Only US regions');
      await expect(service.upsertRegion('org-1', 'US', 'ZZ', { collecting: true })).rejects.toThrow('two-letter US state');
    });
  });
});
