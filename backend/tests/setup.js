// Test setup file for Jest
// Runs before each test file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-secret-key-must-be-at-least-32-chars';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/jump_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
process.env.RESEND_API_KEY = 're_test_fake_key';

// Disconnect Prisma after all tests to prevent open handles
import { prisma } from '@jump/db';

afterAll(async () => {
  await prisma.$disconnect();
});

// Global test timeout is set in jest.config.js (testTimeout: 30000)
