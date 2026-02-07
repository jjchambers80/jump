// Auth Routes
// POST /auth/register - Register customer account (FR-021)
// POST /auth/login - Login (FR-021)
// POST /auth/logout - Logout and invalidate session (FR-023)
// GET /auth/me - Get current user info (FR-021)

import express from 'express';
import rateLimit from 'express-rate-limit';
import AuthService from '../../services/AuthService.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

// Rate limiter for login endpoint: 5 attempts per 15 minutes per IP (FR-022)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TooManyRequests',
    message: 'Too many login attempts. Please try again later.',
  },
  skipSuccessfulRequests: false,
});

/**
 * POST /auth/register
 * Register a new customer account
 */
router.post('/register', async (req, res, next) => {
  try {
    const { email, name, password } = req.body;

    const user = await AuthService.register(email, name, password);

    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/login
 * Login as customer or admin
 * Sets HttpOnly session cookie (FR-023)
 */
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { user, userType, sessionToken } = await AuthService.login(email, password);

    // Set session cookie (HttpOnly, Secure in production, SameSite=Strict)
    res.cookie('sessionId', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/',
    });

    res.json({ user, userType });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/logout
 * Invalidate session and clear cookie (FR-023)
 */
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token =
      req.cookies?.sessionId ||
      (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

    await AuthService.logout(token);

    // Clear session cookie
    res.clearCookie('sessionId', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /auth/me
 * Get current authenticated user info
 */
router.get('/me', async (req, res, next) => {
  try {
    const token =
      req.cookies?.sessionId ||
      (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

    const { user, userType } = await AuthService.getCurrentUser(token);

    res.json({ user, userType });
  } catch (error) {
    next(error);
  }
});

export default router;
