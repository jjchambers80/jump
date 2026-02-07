// Admin Validators
// Request validation for admin event operations per FR-012

import { ValidationError } from '../../middleware/errorHandler.js';

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
