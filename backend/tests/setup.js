// Test setup file for Jest
// Runs before each test file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/jump_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
process.env.SENDGRID_API_KEY = 'SG.test_key';

// Global test timeout is set in jest.config.js (testTimeout: 30000)
