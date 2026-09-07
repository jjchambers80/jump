import { ValidationError } from '../../middleware/errorHandler.js';

const CREATE_PERSON_FIELDS = new Set([
  'firstName',
  'lastName',
  'dateOfBirth',
  'isAccountRepresentative',
]);
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeName(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} is required`);
  }

  const normalized = value.trim();
  if (normalized.length > 100) {
    throw new ValidationError(`${label} must be 100 characters or less`);
  }
  return normalized;
}

function parseDateOnly(value) {
  if (typeof value !== 'string') {
    throw new ValidationError('Date of birth must use YYYY-MM-DD format');
  }

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new ValidationError('Date of birth must use YYYY-MM-DD format');
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError('Date of birth must be a real calendar date');
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > todayUtc) {
    throw new ValidationError('Date of birth cannot be in the future');
  }

  return date;
}

export const validateCreateOrganizationPerson = (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new ValidationError('Request body must be an object');
    }

    const unknownField = Object.keys(req.body).find((field) => !CREATE_PERSON_FIELDS.has(field));
    if (unknownField) {
      throw new ValidationError(`Unknown field: ${unknownField}`);
    }

    req.body.firstName = normalizeName(req.body.firstName, 'First name');
    req.body.lastName = normalizeName(req.body.lastName, 'Last name');
    req.body.dateOfBirth = parseDateOnly(req.body.dateOfBirth);

    if (typeof req.body.isAccountRepresentative !== 'boolean') {
      throw new ValidationError('isAccountRepresentative must be a boolean');
    }

    next();
  } catch (error) {
    next(error);
  }
};
