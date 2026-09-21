// Map validators (spec 014 phase 1)
// Input validation for floor map and layout endpoints.

import { ValidationError } from '../../middleware/errorHandler.js';
import {
  MAX_MAP_WIDTH, MIN_MAP_NAME_LENGTH, MAX_MAP_NAME_LENGTH, UNITS,
} from '../../config/maps.js';

const CREATE_FIELDS = new Set(['eventId', 'name', 'width', 'height', 'unit', 'gridSize', 'underlayFileId', 'underlayOpacity', 'layout', 'templateId', 'tierBindings']);
const UPDATE_FIELDS = new Set(['name', 'width', 'height', 'unit', 'gridSize', 'underlayFileId', 'underlayOpacity', 'layout']);

function rejectUnknown(body, allowed) {
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return `Unknown field(s): ${unknown.join(', ')}`;
  return null;
}

/**
 * Validate POST /admin/maps payload.
 */
export const validateCreateMap = (req, res, next) => {
  try {
    const err = rejectUnknown(req.body, CREATE_FIELDS);
    if (err) return next(new ValidationError(err));

    const { name, width, height, unit } = req.body;

    if (req.body.templateId !== undefined && (typeof req.body.templateId !== 'string' || !req.body.templateId)) {
      return next(new ValidationError('templateId must be an id'));
    }
    if (req.body.tierBindings !== undefined && (!req.body.tierBindings || typeof req.body.tierBindings !== 'object' || Array.isArray(req.body.tierBindings))) {
      return next(new ValidationError('tierBindings must be an object'));
    }

    if (name !== undefined && typeof name === 'string') {
      const trimmed = name.trim();
      if (trimmed.length < MIN_MAP_NAME_LENGTH || trimmed.length > MAX_MAP_NAME_LENGTH) {
        return next(new ValidationError(`name must be ${MIN_MAP_NAME_LENGTH}–${MAX_MAP_NAME_LENGTH} characters`));
      }
      req.body.name = trimmed;
    }

    if (width !== undefined) {
      if (!Number.isInteger(width) || width < 1 || width > MAX_MAP_WIDTH) {
        return next(new ValidationError(`width must be an integer between 1 and ${MAX_MAP_WIDTH}`));
      }
    }

    if (height !== undefined) {
      if (!Number.isInteger(height) || height < 1 || height > MAX_MAP_WIDTH) {
        return next(new ValidationError(`height must be an integer between 1 and ${MAX_MAP_WIDTH}`));
      }
    }

    if (unit !== undefined && !UNITS.has(unit)) {
      return next(new ValidationError('unit must be "ft" or "m"'));
    }

    if (req.body.gridSize !== undefined) {
      if (!Number.isInteger(req.body.gridSize) || req.body.gridSize < 1 || req.body.gridSize > 100) {
        return next(new ValidationError('gridSize must be between 1 and 100'));
      }
    }

    if (req.body.underlayOpacity !== undefined) {
      if (!Number.isInteger(req.body.underlayOpacity) || req.body.underlayOpacity < 0 || req.body.underlayOpacity > 100) {
        return next(new ValidationError('underlayOpacity must be 0–100'));
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Validate PATCH /admin/maps/:id payload.
 */
export const validateUpdateMap = (req, res, next) => {
  try {
    const err = rejectUnknown(req.body, UPDATE_FIELDS);
    if (err) return next(new ValidationError(err));

    if (Object.keys(req.body).length === 0) {
      return next(new ValidationError('No fields to update'));
    }

    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || req.body.name.trim().length < MIN_MAP_NAME_LENGTH) {
        return next(new ValidationError(`name must be ${MIN_MAP_NAME_LENGTH}–${MAX_MAP_NAME_LENGTH} characters`));
      }
      req.body.name = req.body.name.trim();
    }

    if (req.body.width !== undefined) {
      if (!Number.isInteger(req.body.width) || req.body.width < 1 || req.body.width > MAX_MAP_WIDTH) {
        return next(new ValidationError(`width must be an integer between 1 and ${MAX_MAP_WIDTH}`));
      }
    }

    if (req.body.height !== undefined) {
      if (!Number.isInteger(req.body.height) || req.body.height < 1 || req.body.height > MAX_MAP_WIDTH) {
        return next(new ValidationError(`height must be an integer between 1 and ${MAX_MAP_WIDTH}`));
      }
    }

    if (req.body.unit !== undefined && !UNITS.has(req.body.unit)) {
      return next(new ValidationError('unit must be "ft" or "m"'));
    }

    if (req.body.gridSize !== undefined) {
      if (!Number.isInteger(req.body.gridSize) || req.body.gridSize < 1 || req.body.gridSize > 100) {
        return next(new ValidationError('gridSize must be between 1 and 100'));
      }
    }

    if (req.body.underlayOpacity !== undefined) {
      if (!Number.isInteger(req.body.underlayOpacity) || req.body.underlayOpacity < 0 || req.body.underlayOpacity > 100) {
        return next(new ValidationError('underlayOpacity must be 0–100'));
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};