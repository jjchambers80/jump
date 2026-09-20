// Error handler middleware
// Centralized error response formatting per FR-016

import logger from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  const uniqueTarget = Array.isArray(err?.meta?.target)
    ? err.meta.target
    : [String(err?.meta?.target || '')];
  if (
    err?.code === 'P2002' &&
    uniqueTarget.some((field) => field.includes('slug') || field.includes('handle'))
  ) {
    err.name = 'ConflictError';
    err.statusCode = 409;
    err.message = 'That URL slug is already in use';
    err.details = { field: 'slug' };
  }

  // Log error with correlation ID
  const correlationId = req.headers['x-correlation-id'] || req.id;
  const logMethod = err.statusCode && err.statusCode < 500 ? 'warn' : 'error';
  logger[logMethod]('Request error', {
    correlationId,
    error: err.name,
    message: err.message,
    path: req.path,
    method: req.method,
    statusCode: err.statusCode || 500,
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Format error response
  const errorResponse = {
    error: err.name || 'Error',
    message: err.message || 'An unexpected error occurred',
    // Machine-readable code for clients that branch on it (e.g. LEGAL_VERSION_STALE → reload the versions)
    ...(typeof err.code === 'string' && err.code && { code: err.code }),
    ...(err.details && { details: err.details }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  };

  res.status(statusCode).json(errorResponse);
};

// Custom error classes
export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

export class AuthenticationError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Access forbidden') {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
  }
}

/**
 * Private storefront (Online Store › Preferences) and no valid access token.
 * 403 with `details: { locked: true, organization, message }` so storefront
 * pages can render the password gate and retry.
 */
export class StorefrontLockedError extends Error {
  constructor(organization, message) {
    super('This store is private');
    this.name = 'StorefrontLockedError';
    this.statusCode = 403;
    this.details = { locked: true, organization, message };
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
  }
}

export class ConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
    this.details = details;
  }
}
