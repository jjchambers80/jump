// Authentication Service
// Handles registration, login, logout, and session management per FR-021, FR-022, FR-023

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { ValidationError, AuthenticationError, ConflictError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { activeSessionsGauge } from '../utils/metrics.js';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours (FR-023)

class AuthService {
  /**
   * Register a new customer account (FR-021)
   * @param {string} email - Customer email
   * @param {string} name - Customer full name
   * @param {string} password - Plain text password (min 8 chars)
   * @returns {Promise<Object>} Created customer (without password hash)
   */
  async register(email, name, password) {
    // Validate inputs
    if (!email || !name || !password) {
      throw new ValidationError('Email, name, and password are required');
    }

    // Email format validation (RFC 5322 basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }

    // Password minimum length (FR-022)
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    // Check for duplicate email
    const existing = await prisma.customer.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictError('Email already registered');
    }

    // Hash password with bcrypt (FR-022)
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create customer
    const customer = await prisma.customer.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    logger.info('Customer registered', {
      event: 'customer_registered',
      customerId: customer.id,
      email: customer.email,
    });

    return customer;
  }

  /**
   * Login user (customer or admin) (FR-021)
   * @param {string} email - User email
   * @param {string} password - Plain text password
   * @returns {Promise<{user: Object, userType: string, sessionToken: string}>}
   */
  async login(email, password) {
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    const normalizedEmail = email.toLowerCase();

    // Try admin first, then customer
    let user = null;
    let userType = null;

    const admin = await prisma.admin.findUnique({
      where: { email: normalizedEmail },
    });

    if (admin) {
      const valid = await bcrypt.compare(password, admin.passwordHash);
      if (!valid) {
        throw new AuthenticationError('Invalid credentials');
      }
      user = {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        organization: admin.organization,
      };
      userType = 'admin';
    } else {
      const customer = await prisma.customer.findUnique({
        where: { email: normalizedEmail },
      });

      if (!customer) {
        throw new AuthenticationError('Invalid credentials');
      }

      if (!customer.passwordHash) {
        throw new AuthenticationError('Account not activated. Please set a password first.');
      }

      const valid = await bcrypt.compare(password, customer.passwordHash);
      if (!valid) {
        throw new AuthenticationError('Invalid credentials');
      }
      user = {
        id: customer.id,
        email: customer.email,
        name: customer.name,
      };
      userType = 'customer';
    }

    // Create session (FR-023)
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await prisma.session.create({
      data: {
        adminId: userType === 'admin' ? user.id : null,
        customerId: userType === 'customer' ? user.id : null,
        userType: userType === 'admin' ? 'ADMIN' : 'CUSTOMER',
        token: sessionToken,
        expiresAt,
      },
    });

    activeSessionsGauge.inc();

    logger.info('User logged in', {
      event: 'user_login',
      userId: user.id,
      userType,
    });

    return { user, userType, sessionToken };
  }

  /**
   * Logout and invalidate session (FR-023)
   * @param {string} sessionToken - Session token to invalidate
   */
  async logout(sessionToken) {
    if (!sessionToken) {
      throw new AuthenticationError('No session token provided');
    }

    const session = await prisma.session.findUnique({
      where: { token: sessionToken },
    });

    if (!session) {
      throw new AuthenticationError('Invalid session');
    }

    await prisma.session.delete({
      where: { id: session.id },
    });

    activeSessionsGauge.dec();

    logger.info('User logged out', {
      event: 'user_logout',
      userId: session.adminId || session.customerId,
      userType: session.userType,
    });
  }

  /**
   * Get current user from session token (FR-021)
   * @param {string} sessionToken - Session token
   * @returns {Promise<{user: Object, userType: string}>}
   */
  async getCurrentUser(sessionToken) {
    if (!sessionToken) {
      throw new AuthenticationError('No session token provided');
    }

    const session = await prisma.session.findUnique({
      where: { token: sessionToken },
      include: {
        admin: true,
        customer: true,
      },
    });

    if (!session) {
      throw new AuthenticationError('Invalid session');
    }

    // Check expiration
    if (new Date() > session.expiresAt) {
      await prisma.session.delete({ where: { id: session.id } });
      throw new AuthenticationError('Session expired');
    }

    // Refresh session expiration on activity (FR-023)
    await prisma.session.update({
      where: { id: session.id },
      data: {
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      },
    });

    let user;
    let userType;

    if (session.userType === 'ADMIN' && session.admin) {
      user = {
        id: session.admin.id,
        email: session.admin.email,
        name: session.admin.name,
        organization: session.admin.organization,
      };
      userType = 'admin';
    } else if (session.customer) {
      user = {
        id: session.customer.id,
        email: session.customer.email,
        name: session.customer.name,
      };
      userType = 'customer';
    } else {
      throw new AuthenticationError('Invalid session');
    }

    return { user, userType };
  }
}

export default new AuthService();
