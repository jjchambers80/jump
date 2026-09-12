// Organization validators
// Input validation for organization endpoints per FR-048

import { ValidationError } from '../../middleware/errorHandler.js';

export const BUSINESS_TYPES = [
  'SOLE_PROPRIETORSHIP',
  'SINGLE_MEMBER_LLC',
  'MULTI_MEMBER_LLC',
  'PARTNERSHIP',
  'C_CORPORATION',
  'S_CORPORATION',
  'NONPROFIT',
];

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'AS',
  'GU', 'MP', 'PR', 'VI',
]);

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const THEME_MODES = ['LIGHT', 'DARK', 'SYSTEM', 'USER'];

/** Normalize a theme mode to its uppercase enum value, or return null when invalid. */
export const normalizeThemeMode = (value) => {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return THEME_MODES.includes(upper) ? upper : null;
};

/** Normalize a hex color to lowercase #rrggbb, or return null when invalid. */
export const normalizeHexColor = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;
  let hex = trimmed.slice(1).toLowerCase();
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  return `#${hex}`;
};

const BUSINESS_DETAIL_FIELDS = new Set([
  'name', 'businessType', 'nickname', 'countryCode', 'addressLine1', 'addressLine2',
  'city', 'state', 'postalCode', 'phoneCountryCode', 'phoneNumber', 'ein',
]);

const normalizeRequiredString = (body, field, label, maxLength = 255) => {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} is required`);
  }
  if (value.trim().length > maxLength) {
    throw new ValidationError(`${label} must be ${maxLength} characters or less`);
  }
  body[field] = value.trim();
};

const normalizeOptionalString = (body, field, label, maxLength = 255) => {
  const value = body[field];
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} must be a string or null`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ValidationError(`${label} must be ${maxLength} characters or less`);
  }
  body[field] = normalized || null;
};

/**
 * Validate organization creation payload
 */
export const validateCreateOrganization = (req, res, next) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new ValidationError('Organization name is required'));
  }

  if (name.trim().length > 255) {
    return next(new ValidationError('Organization name must be 255 characters or less'));
  }

  // Normalize
  req.body.name = name.trim();

  next();
};

/**
 * Validate organization update payload
 */
export const validateUpdateOrganization = (req, res, next) => {
  const { name, status, brandColor, themeMode } = req.body;

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return next(new ValidationError('Organization name must be a non-empty string'));
    }
    if (name.trim().length > 255) {
      return next(new ValidationError('Organization name must be 255 characters or less'));
    }
    req.body.name = name.trim();
  }

  if (status !== undefined) {
    const validStatuses = ['ACTIVE', 'INACTIVE'];
    if (!validStatuses.includes(status)) {
      return next(new ValidationError(`Status must be one of: ${validStatuses.join(', ')}`));
    }
  }

  // brandColor: null clears; string must be a 3- or 6-digit hex, normalized to #rrggbb
  if (brandColor !== undefined && brandColor !== null) {
    const normalized = normalizeHexColor(brandColor);
    if (!normalized) {
      return next(new ValidationError('Brand color must be a hex value like #1d4ed8'));
    }
    req.body.brandColor = normalized;
  }

  // themeMode: enum value, case-insensitive input normalized to uppercase
  if (themeMode !== undefined) {
    const normalized = normalizeThemeMode(themeMode);
    if (!normalized) {
      return next(new ValidationError(`Theme mode must be one of: ${THEME_MODES.join(', ')}`));
    }
    req.body.themeMode = normalized;
  }

  next();
};

/** Validate and normalize the complete current-organization business details form. */
export const validateUpdateBusinessDetails = (req, res, next) => {
  try {
    const fields = Object.keys(req.body || {});
    const unknownField = fields.find((field) => !BUSINESS_DETAIL_FIELDS.has(field));
    if (unknownField) {
      throw new ValidationError(`Unknown field: ${unknownField}`);
    }

    normalizeRequiredString(req.body, 'name', 'Registered legal business name');
    normalizeRequiredString(req.body, 'addressLine1', 'Business address');
    normalizeRequiredString(req.body, 'city', 'City', 100);
    normalizeOptionalString(req.body, 'nickname', 'Nickname');
    normalizeOptionalString(req.body, 'addressLine2', 'Address line 2');

    if (!BUSINESS_TYPES.includes(req.body.businessType)) {
      throw new ValidationError('Type of business is invalid');
    }

    if (
      typeof req.body.countryCode !== 'string' ||
      req.body.countryCode.toUpperCase() !== 'US'
    ) {
      throw new ValidationError('Country code must be US');
    }
    req.body.countryCode = 'US';

    if (
      typeof req.body.state !== 'string' ||
      !US_STATE_CODES.has(req.body.state.toUpperCase())
    ) {
      throw new ValidationError('State must be a valid two-letter US state or territory code');
    }
    req.body.state = req.body.state.toUpperCase();

    if (
      typeof req.body.postalCode !== 'string' ||
      !/^\d{5}(-\d{4})?$/.test(req.body.postalCode.trim())
    ) {
      throw new ValidationError('ZIP code must be 5 digits or ZIP+4');
    }
    req.body.postalCode = req.body.postalCode.trim();

    if (req.body.phoneCountryCode !== '+1') {
      throw new ValidationError('Phone country code must be +1');
    }

    if (
      req.body.phoneNumber === undefined ||
      req.body.phoneNumber === null ||
      req.body.phoneNumber === ''
    ) {
      req.body.phoneNumber = null;
    } else if (typeof req.body.phoneNumber === 'string') {
      if (!/^[\d\s().-]+$/.test(req.body.phoneNumber)) {
        throw new ValidationError('Phone number contains invalid characters');
      }
      const digits = req.body.phoneNumber.replace(/\D/g, '');
      if (digits.length !== 10) {
        throw new ValidationError('Phone number must contain 10 digits');
      }
      req.body.phoneNumber = digits;
    } else {
      throw new ValidationError('Phone number must be a string or null');
    }

    if (req.body.ein !== undefined && req.body.ein !== null) {
      if (typeof req.body.ein !== 'string') {
        throw new ValidationError('EIN must be a string or null');
      }
      if (!/^\d{2}-?\d{7}$/.test(req.body.ein.trim())) {
        throw new ValidationError('EIN must contain 9 digits');
      }
      const digits = req.body.ein.replace(/\D/g, '');
      if (digits.length !== 9) {
        throw new ValidationError('EIN must contain 9 digits');
      }
      req.body.ein = digits;
    }

    next();
  } catch (error) {
    next(error);
  }
};
