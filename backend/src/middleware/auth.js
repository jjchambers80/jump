// Authentication middleware
// Verifies Auth.js HS256 JWT tokens from Authorization Bearer header
// Attaches decoded user { sub, email, role, name } to req.user

import jwt from 'jsonwebtoken';
import { AuthenticationError } from './errorHandler.js';

const AUTH_SECRET = process.env.AUTH_SECRET;

/**
 * Middleware that requires a valid Auth.js JWT token.
 * Extracts token from Authorization: Bearer <token> header.
 * Attaches decoded user info to req.user.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('No authorization token provided');
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    if (!AUTH_SECRET) {
      throw new AuthenticationError('Server auth configuration error');
    }

    // Verify the HS256 JWT signed by Auth.js
    const decoded = jwt.verify(token, AUTH_SECRET, {
      algorithms: ['HS256'],
    });

    // Attach user info to request
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      name: decoded.name,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AuthenticationError('Invalid or expired token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AuthenticationError('Token expired'));
    } else {
      next(error);
    }
  }
};

/**
 * Optional auth middleware — attaches user if token is present, but doesn't fail if absent.
 * Useful for routes that behave differently for authenticated vs guest users.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ') && AUTH_SECRET) {
      const token = authHeader.slice(7);
      try {
        const decoded = jwt.verify(token, AUTH_SECRET, {
          algorithms: ['HS256'],
        });
        req.user = {
          id: decoded.sub,
          email: decoded.email,
          role: decoded.role,
          name: decoded.name,
        };
      } catch {
        // Token invalid — proceed without user
        req.user = null;
      }
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    next(error);
  }
};
