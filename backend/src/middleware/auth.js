// Authentication middleware
// Session token validation per FR-021, FR-023

import { PrismaClient } from '@prisma/client';
import { AuthenticationError } from './errorHandler.js';

const prisma = new PrismaClient();

export const requireAuth = async (req, res, next) => {
  try {
    // Extract session token from cookie or Authorization header
    const token =
      req.cookies?.sessionId ||
      (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

    if (!token) {
      throw new AuthenticationError('No session token provided');
    }

    // Validate session in database
    const session = await prisma.session.findUnique({
      where: { token },
      include: {
        admin: true,
        customer: true,
      },
    });

    if (!session) {
      throw new AuthenticationError('Invalid session token');
    }

    // Check expiration (FR-023: 24-hour expiry)
    if (new Date() > session.expiresAt) {
      // Delete expired session
      await prisma.session.delete({ where: { id: session.id } });
      throw new AuthenticationError('Session expired');
    }

    // Refresh expiration on activity (24 hours from now)
    await prisma.session.update({
      where: { id: session.id },
      data: {
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Attach user info to request
    req.user = {
      id: session.adminId || session.customerId,
      type: session.userType,
      email: session.userType === 'ADMIN' ? session.admin.email : session.customer.email,
      name: session.userType === 'ADMIN' ? session.admin.name : session.customer.name,
    };
    req.sessionId = session.id;

    next();
  } catch (error) {
    next(error);
  }
};
