// Admin Validators
// Request validation for admin event operations per FR-012

import { ValidationError } from '../../middleware/errorHandler.js';

/** GET /admin/search?q= — trim and bound the launcher query before any DB work. */
export const validateAdminSearchQuery = (req, res, next) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 200) {
    return next(
      new ValidationError('Validation failed', [
        { field: 'q', message: 'q must be 2–200 characters' },
      ])
    );
  }
  req.adminSearchQuery = query;
  next();
};

/**
 * Validate event creation request
 * name: required, max 255 chars
 * date: required, ISO 8601, future
 * venue: required, max 500 chars
 * capacity: required, 1-100,000
 * ticketPrice: required, >= 0, decimal
 */
export const validateEventCreate = (req, res, next) => {
  try {
    const { name, date, venue, capacity, ticketPrice } = req.body;
    const errors = [];

    // Name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      errors.push('Event name is required');
    } else if (name.length > 255) {
      errors.push('Event name must be 255 characters or less');
    }

    // Date
    if (!date) {
      errors.push('Event date is required');
    } else {
      const eventDate = new Date(date);
      if (isNaN(eventDate.getTime())) {
        errors.push('Invalid date format. Use ISO 8601 (e.g., 2026-12-31T20:00:00.000Z)');
      } else if (eventDate <= new Date()) {
        errors.push('Event date must be in the future');
      }
    }

    // Venue
    if (!venue || typeof venue !== 'string' || venue.trim().length === 0) {
      errors.push('Venue is required');
    } else if (venue.length > 500) {
      errors.push('Venue must be 500 characters or less');
    }

    // Capacity (FR-012)
    if (capacity === undefined || capacity === null) {
      errors.push('Capacity is required');
    } else {
      const cap = parseInt(capacity);
      if (isNaN(cap) || cap < 1 || cap > 100000) {
        errors.push('Capacity must be between 1 and 100,000');
      }
    }

    // Ticket Price (FR-012)
    if (ticketPrice === undefined || ticketPrice === null) {
      errors.push('Ticket price is required');
    } else {
      const price = parseFloat(ticketPrice);
      if (isNaN(price) || price < 0) {
        errors.push('Ticket price must be 0 or greater');
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Validation failed', { errors });
    }

    next();
  } catch (error) {
    if (error instanceof ValidationError) {
      return next(error);
    }
    next(new ValidationError('Invalid request body'));
  }
};

/**
 * Validate event update request
 * All fields optional, but if provided must be valid
 */
/**
 * Validate attendee update request. Name only (spec 037 D13): the buyer's
 * email is their Contact identity at the organization and is changed only on
 * the customer page, never through a ticket. Named tickets are deferred.
 */
export const validateUpdateAttendee = (req, res, next) => {
  try {
    const { firstName, lastName, email } = req.body || {};
    const errors = [];

    if (email !== undefined) {
      const error = new ValidationError(
        'The buyer email cannot be changed from a ticket. Edit it on the customer page.'
      );
      error.code = 'ATTENDEE_EMAIL_NOT_EDITABLE';
      throw error;
    }

    if (firstName === undefined && lastName === undefined) {
      throw new ValidationError('At least one field (firstName, lastName) is required');
    }

    if (firstName !== undefined) {
      if (typeof firstName !== 'string' || firstName.trim().length === 0) {
        errors.push('First name cannot be empty');
      } else if (firstName.length > 255) {
        errors.push('First name must be 255 characters or less');
      }
    }

    if (lastName !== undefined) {
      if (typeof lastName !== 'string' || lastName.trim().length === 0) {
        errors.push('Last name cannot be empty');
      } else if (lastName.length > 255) {
        errors.push('Last name must be 255 characters or less');
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Validation failed', { errors });
    }

    // Normalize
    if (firstName !== undefined) req.body.firstName = firstName.trim();
    if (lastName !== undefined) req.body.lastName = lastName.trim();

    next();
  } catch (error) {
    if (error instanceof ValidationError) {
      return next(error);
    }
    next(new ValidationError('Invalid request body'));
  }
};

export const validateEventUpdate = (req, res, next) => {
  try {
    const { name, date, venue, capacity, ticketPrice } = req.body;
    const errors = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        errors.push('Event name cannot be empty');
      } else if (name.length > 255) {
        errors.push('Event name must be 255 characters or less');
      }
    }

    if (date !== undefined) {
      const eventDate = new Date(date);
      if (isNaN(eventDate.getTime())) {
        errors.push('Invalid date format');
      } else if (eventDate <= new Date()) {
        errors.push('Event date must be in the future');
      }
    }

    if (venue !== undefined) {
      if (typeof venue !== 'string' || venue.trim().length === 0) {
        errors.push('Venue cannot be empty');
      } else if (venue.length > 500) {
        errors.push('Venue must be 500 characters or less');
      }
    }

    if (capacity !== undefined) {
      const cap = parseInt(capacity);
      if (isNaN(cap) || cap < 1 || cap > 100000) {
        errors.push('Capacity must be between 1 and 100,000');
      }
    }

    if (ticketPrice !== undefined) {
      const price = parseFloat(ticketPrice);
      if (isNaN(price) || price < 0) {
        errors.push('Ticket price must be 0 or greater');
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Validation failed', { errors });
    }

    next();
  } catch (error) {
    if (error instanceof ValidationError) {
      return next(error);
    }
    next(new ValidationError('Invalid request body'));
  }
};
