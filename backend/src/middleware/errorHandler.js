// Error handler middleware
// Centralized error response formatting per FR-016

import logger from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
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
