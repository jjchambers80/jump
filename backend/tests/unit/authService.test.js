// Unit tests for AuthService
// Tests register, login, logout, getCurrentUser, password hashing

import { jest } from '@jest/globals';

// Mock dependencies
const mockCustomerCreate = jest.fn();
const mockCustomerFindUnique = jest.fn();
const mockAdminFindUnique = jest.fn();
const mockSessionCreate = jest.fn();
const mockSessionFindUnique = jest.fn();
const mockSessionDelete = jest.fn();
const mockSessionUpdate = jest.fn();

jest.unstable_mockModule('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    customer: {
      create: mockCustomerCreate,
      findUnique: mockCustomerFindUnique,
    },
    admin: {
      findUnique: mockAdminFindUnique,
    },
    session: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      delete: mockSessionDelete,
      update: mockSessionUpdate,
    },
  })),
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/utils/metrics.js', () => ({
  activeSessionsGauge: {
    inc: jest.fn(),
    dec: jest.fn(),
    set: jest.fn(),
  },
}));

// bcrypt is NOT mocked - we test real hashing behavior
const { default: AuthService } = await import('../../src/services/AuthService.js');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create a customer with hashed password', async () => {
      mockCustomerFindUnique.mockResolvedValue(null); // No existing customer
      mockCustomerCreate.mockResolvedValue({
        id: 'cust-1',
        email: 'user@test.com',
        name: 'Test User',
        createdAt: new Date(),
      });

      const result = await AuthService.register('user@test.com', 'Test User', 'password123');

      expect(result.id).toBe('cust-1');
      expect(result.email).toBe('user@test.com');
      expect(mockCustomerCreate).toHaveBeenCalledTimes(1);

      // Verify password is hashed (not plain text)
      const createCall = mockCustomerCreate.mock.calls[0][0];
      expect(createCall.data.passwordHash).not.toBe('password123');
      expect(createCall.data.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash pattern
    });

    it('should throw ValidationError for missing email', async () => {
      await expect(AuthService.register('', 'Test User', 'password123')).rejects.toThrow(
        'Email, name, and password are required'
      );
    });

    it('should throw ValidationError for missing name', async () => {
      await expect(AuthService.register('user@test.com', '', 'password123')).rejects.toThrow(
        'Email, name, and password are required'
      );
    });

    it('should throw ValidationError for missing password', async () => {
      await expect(AuthService.register('user@test.com', 'Test User', '')).rejects.toThrow(
        'Email, name, and password are required'
      );
    });

    it('should throw ValidationError for invalid email format', async () => {
      await expect(
        AuthService.register('not-an-email', 'Test User', 'password123')
      ).rejects.toThrow('Invalid email format');
    });

    it('should throw ValidationError for password shorter than 8 characters', async () => {
      await expect(AuthService.register('user@test.com', 'Test User', 'short')).rejects.toThrow(
        'Password must be at least 8 characters'
      );
    });

    it('should throw ConflictError for duplicate email', async () => {
      mockCustomerFindUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        AuthService.register('user@test.com', 'Test User', 'password123')
      ).rejects.toThrow('Email already registered');
    });

    it('should normalize email to lowercase', async () => {
      mockCustomerFindUnique.mockResolvedValue(null);
      mockCustomerCreate.mockResolvedValue({
        id: 'cust-1',
        email: 'user@test.com',
        name: 'Test User',
        createdAt: new Date(),
      });

      await AuthService.register('USER@TEST.COM', 'Test User', 'password123');

      expect(mockCustomerFindUnique).toHaveBeenCalledWith({
        where: { email: 'user@test.com' },
      });
    });
  });

  describe('login', () => {
    it('should login admin user and create session', async () => {
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash('password123', 10);

      mockAdminFindUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@test.com',
        name: 'Admin User',
        organization: 'Test Org',
        passwordHash: hashedPassword,
      });
      mockSessionCreate.mockResolvedValue({});

      const result = await AuthService.login('admin@test.com', 'password123');

      expect(result.user.id).toBe('admin-1');
      expect(result.userType).toBe('admin');
      expect(result.sessionToken).toBeTruthy();
      expect(typeof result.sessionToken).toBe('string');
    });

    it('should login customer user and create session', async () => {
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash('password123', 10);

      mockAdminFindUnique.mockResolvedValue(null); // Not an admin
      mockCustomerFindUnique.mockResolvedValue({
        id: 'cust-1',
        email: 'user@test.com',
        name: 'Test User',
        passwordHash: hashedPassword,
      });
      mockSessionCreate.mockResolvedValue({});

      const result = await AuthService.login('user@test.com', 'password123');

      expect(result.user.id).toBe('cust-1');
      expect(result.userType).toBe('customer');
      expect(result.sessionToken).toBeTruthy();
    });

    it('should throw ValidationError when email is missing', async () => {
      await expect(AuthService.login('', 'password123')).rejects.toThrow(
        'Email and password are required'
      );
    });

    it('should throw ValidationError when password is missing', async () => {
      await expect(AuthService.login('user@test.com', '')).rejects.toThrow(
        'Email and password are required'
      );
    });

    it('should throw AuthenticationError for non-existent user', async () => {
      mockAdminFindUnique.mockResolvedValue(null);
      mockCustomerFindUnique.mockResolvedValue(null);

      await expect(AuthService.login('nobody@test.com', 'password123')).rejects.toThrow(
        'Invalid credentials'
      );
    });

    it('should throw AuthenticationError for wrong admin password', async () => {
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash('correctpassword', 10);

      mockAdminFindUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@test.com',
        name: 'Admin',
        passwordHash: hashedPassword,
      });

      await expect(AuthService.login('admin@test.com', 'wrongpassword')).rejects.toThrow(
        'Invalid credentials'
      );
    });

    it('should throw AuthenticationError for customer without password', async () => {
      mockAdminFindUnique.mockResolvedValue(null);
      mockCustomerFindUnique.mockResolvedValue({
        id: 'cust-1',
        email: 'user@test.com',
        name: 'Test User',
        passwordHash: null,
      });

      await expect(AuthService.login('user@test.com', 'password123')).rejects.toThrow(
        'Account not activated'
      );
    });

    it('should create session with correct userType for admin', async () => {
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash('password123', 10);

      mockAdminFindUnique.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@test.com',
        name: 'Admin',
        organization: 'Org',
        passwordHash: hashedPassword,
      });
      mockSessionCreate.mockResolvedValue({});

      await AuthService.login('admin@test.com', 'password123');

      expect(mockSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: 'admin-1',
            customerId: null,
            userType: 'ADMIN',
          }),
        })
      );
    });

    it('should create session with correct userType for customer', async () => {
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash('password123', 10);

      mockAdminFindUnique.mockResolvedValue(null);
      mockCustomerFindUnique.mockResolvedValue({
        id: 'cust-1',
        email: 'user@test.com',
        name: 'User',
        passwordHash: hashedPassword,
      });
      mockSessionCreate.mockResolvedValue({});

      await AuthService.login('user@test.com', 'password123');

      expect(mockSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adminId: null,
            customerId: 'cust-1',
            userType: 'CUSTOMER',
          }),
        })
      );
    });
  });

  describe('logout', () => {
    it('should delete session on logout', async () => {
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        token: 'valid-token',
        adminId: null,
        customerId: 'cust-1',
        userType: 'CUSTOMER',
      });
      mockSessionDelete.mockResolvedValue({});

      await AuthService.logout('valid-token');

      expect(mockSessionDelete).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
      });
    });

    it('should throw AuthenticationError for missing token', async () => {
      await expect(AuthService.logout('')).rejects.toThrow('No session token provided');
    });

    it('should throw AuthenticationError for invalid token', async () => {
      mockSessionFindUnique.mockResolvedValue(null);

      await expect(AuthService.logout('invalid-token')).rejects.toThrow('Invalid session');
    });
  });

  describe('getCurrentUser', () => {
    it('should return admin user from valid session', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        token: 'valid-token',
        userType: 'ADMIN',
        expiresAt: futureDate,
        admin: {
          id: 'admin-1',
          email: 'admin@test.com',
          name: 'Admin',
          organization: 'Org',
        },
        customer: null,
      });
      mockSessionUpdate.mockResolvedValue({});

      const result = await AuthService.getCurrentUser('valid-token');

      expect(result.user.id).toBe('admin-1');
      expect(result.userType).toBe('admin');
    });

    it('should return customer user from valid session', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        token: 'valid-token',
        userType: 'CUSTOMER',
        expiresAt: futureDate,
        admin: null,
        customer: {
          id: 'cust-1',
          email: 'user@test.com',
          name: 'User',
        },
      });
      mockSessionUpdate.mockResolvedValue({});

      const result = await AuthService.getCurrentUser('valid-token');

      expect(result.user.id).toBe('cust-1');
      expect(result.userType).toBe('customer');
    });

    it('should refresh session expiration on activity', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        token: 'valid-token',
        userType: 'CUSTOMER',
        expiresAt: futureDate,
        admin: null,
        customer: { id: 'cust-1', email: 'user@test.com', name: 'User' },
      });
      mockSessionUpdate.mockResolvedValue({});

      await AuthService.getCurrentUser('valid-token');

      expect(mockSessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          data: expect.objectContaining({
            expiresAt: expect.any(Date),
          }),
        })
      );
    });

    it('should throw AuthenticationError for expired session', async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        token: 'expired-token',
        userType: 'CUSTOMER',
        expiresAt: pastDate,
        admin: null,
        customer: { id: 'cust-1', email: 'user@test.com', name: 'User' },
      });
      mockSessionDelete.mockResolvedValue({});

      await expect(AuthService.getCurrentUser('expired-token')).rejects.toThrow('Session expired');
    });

    it('should delete expired session from database', async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockSessionFindUnique.mockResolvedValue({
        id: 'sess-1',
        token: 'expired-token',
        userType: 'CUSTOMER',
        expiresAt: pastDate,
        admin: null,
        customer: null,
      });
      mockSessionDelete.mockResolvedValue({});

      await expect(AuthService.getCurrentUser('expired-token')).rejects.toThrow();

      expect(mockSessionDelete).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
      });
    });

    it('should throw AuthenticationError for missing token', async () => {
      await expect(AuthService.getCurrentUser('')).rejects.toThrow('No session token provided');
    });

    it('should throw AuthenticationError for invalid token', async () => {
      mockSessionFindUnique.mockResolvedValue(null);

      await expect(AuthService.getCurrentUser('invalid-token')).rejects.toThrow('Invalid session');
    });
  });
});
