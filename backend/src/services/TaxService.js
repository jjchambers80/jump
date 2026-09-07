// Tax Service
// Computes venue-based tax rates via Stripe Tax Calculation API
// Option A: rate computed once per event, stored on Event.taxRate

import stripe from '../config/stripe.js';
import logger from '../utils/logger.js';

// Stripe product tax code for general event admissions
const ADMISSIONS_TAX_CODE = 'txcd_20060057';

class TaxService {
  /**
   * Look up the effective tax rate for a venue location.
   * Creates a Stripe Tax calculation with a reference amount and derives the rate.
   *
   * @param {string} postalCode - Venue postal code (US)
   * @param {string} [country='US'] - ISO country code
   * @returns {Promise<number>} Effective tax rate as decimal (e.g. 0.08875 for 8.875%)
   */
  async getTaxRateForVenue(postalCode, country = 'US') {
    if (!postalCode) {
      logger.warn('No postal code provided for tax rate lookup, defaulting to 0');
      return 0;
    }

    try {
      // Use $100 reference amount (10000 cents) to derive rate
      const referenceAmountCents = 10000;

      const calculation = await stripe.tax.calculations.create({
        currency: 'usd',
        customer_details: {
          address: {
            country,
            postal_code: postalCode,
          },
          address_source: 'shipping', // venue location = where service is delivered
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

      const taxRate = calculation.tax_amount_exclusive / referenceAmountCents;

      logger.info('Tax rate computed', {
        event: 'tax_rate_computed',
        postalCode,
        country,
        taxRate,
        stripeTaxCalculationId: calculation.id,
      });

      return taxRate;
    } catch (error) {
      logger.error('Stripe Tax calculation failed, defaulting to 0', {
        event: 'tax_rate_error',
        postalCode,
        country,
        error: error.message,
      });
      return 0;
    }
  }
}

export default new TaxService();
