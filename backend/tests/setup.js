// Test setup file for Jest
// Runs before each test file

import { resolveTestDatabaseUrl } from './testDatabase.js';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-secret-key-must-be-at-least-32-chars';
// Test database: TEST_DATABASE_URL, else DATABASE_URL from backend/.env with the
// database renamed to jump_test (see tests/testDatabase.js). globalSetup creates
// and migrates it.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
process.env.RESEND_API_KEY = 're_test_fake_key';
// Domain verify calls in contract tests run back to back; no user-check cooldown
process.env.DOMAIN_VERIFY_COOLDOWN_MS = '0';

// Disconnect Prisma after all tests to prevent open handles
import { prisma } from '@jump/db';

afterAll(async () => {
  await prisma.$disconnect();
});

// Global test timeout is set in jest.config.js (testTimeout: 30000)
