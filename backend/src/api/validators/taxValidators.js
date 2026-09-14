// Tax settings validators (spec 009)
// PUT /admin/settings/tax/regions/:country/:region

import { ValidationError } from '../../middleware/errorHandler.js';
import { US_STATES } from '../../utils/usStates.js';

const REGION_FIELDS = new Set(['collecting', 'source', 'manualRate']);
const SOURCES = new Set(['STRIPE', 'MANUAL']);
// Highest combined US sales tax is ~12%; 50% leaves room without accepting typos like 825.
const MAX_MANUAL_RATE = 0.5;

/** Validate and upper-case the :country/:region path params. */
export const validateTaxRegionParams = (req, res, next) => {
  const country = String(req.params.country || '').toUpperCase();
  const region = String(req.params.region || '').toUpperCase();
  if (country !== 'US') return next(new ValidationError('Only US tax regions are supported'));
  if (!US_STATES[region]) return next(new ValidationError('Region must be a two-letter US state code'));
  req.params.country = country;
  req.params.region = region;
  next();
};

/**
 * Validate the region body. Normalises `manualRate` to a number with at most
 * 5 decimals (matches Decimal(6,5)). Use after validateTaxRegionParams.
 */
export const validateUpsertTaxRegion = (req, res, next) => {
  const body = req.body || {};
  const unknown = Object.keys(body).filter((f) => !REGION_FIELDS.has(f));
  if (unknown.length > 0) return next(new ValidationError(`Unknown field(s): ${unknown.join(', ')}`));

  const { collecting, source, manualRate } = body;
  if (typeof collecting !== 'boolean') return next(new ValidationError('collecting must be a boolean'));

  if (source !== undefined && !SOURCES.has(source)) {
    return next(new ValidationError('source must be STRIPE or MANUAL'));
  }
  const resolvedSource = source || 'STRIPE';

  if (resolvedSource === 'MANUAL') {
    if (!collecting) return next(new ValidationError('A manual rate only applies when collecting'));
    const rate = typeof manualRate === 'string' ? Number(manualRate) : manualRate;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      return next(new ValidationError('manualRate is required for a manual tax rate'));
    }
    if (rate < 0 || rate > MAX_MANUAL_RATE) {
      return next(new ValidationError(`manualRate must be between 0 and ${MAX_MANUAL_RATE} (as a decimal, e.g. 0.0825)`));
    }
    req.body.manualRate = Math.round(rate * 100000) / 100000;
  } else if (manualRate !== undefined && manualRate !== null) {
    return next(new ValidationError('manualRate is only allowed when source is MANUAL'));
  } else {
    req.body.manualRate = null;
  }
  req.body.source = resolvedSource;

  next();
};

/** PATCH /admin/settings/tax { taxInclusivePricing } */
export const validateUpdateTaxSettings = (req, res, next) => {
  const body = req.body || {};
  const unknown = Object.keys(body).filter((f) => f !== 'taxInclusivePricing');
  if (unknown.length > 0) return next(new ValidationError(`Unknown field(s): ${unknown.join(', ')}`));
  if (typeof body.taxInclusivePricing !== 'boolean') {
    return next(new ValidationError('taxInclusivePricing must be a boolean'));
  }
  next();
};

const MAX_REPORT_DAYS = 366 * 3;

/**
 * GET /admin/settings/tax/report?from&to&format — ISO dates (YYYY-MM-DD or
 * full timestamps). Defaults to the current calendar year to date. `to` is
 * inclusive to the end of its day when given as a date.
 */
export const validateTaxReportQuery = (req, res, next) => {
  const now = new Date();
  const parse = (value, endOfDay) => {
    if (value === undefined) return null;
    if (typeof value !== 'string') return NaN;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const d = new Date(dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value);
    return d;
  };
  const from = parse(req.query.from, false) ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const to = parse(req.query.to, true) ?? now;
  if (Number.isNaN(from?.getTime?.()) || Number.isNaN(to?.getTime?.())) {
    return next(new ValidationError('from and to must be ISO dates'));
  }
  if (from > to) return next(new ValidationError('from must be on or before to'));
  if ((to - from) / 86400000 > MAX_REPORT_DAYS) return next(new ValidationError('Report range cannot exceed three years'));
  const format = req.query.format === undefined ? 'json' : String(req.query.format).toLowerCase();
  if (!['json', 'csv'].includes(format)) return next(new ValidationError('format must be json or csv'));
  req.taxReport = { from, to, format };
  next();
};
