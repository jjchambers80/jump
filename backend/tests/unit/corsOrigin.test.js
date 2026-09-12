import { describe, expect, it } from '@jest/globals';

// FRONTEND_URL is read at import time, so set it before loading the server.
process.env.FRONTEND_URL = 'http://localhost:3001, https://app.example.com';
const { isAllowedOrigin } = await import('../../src/api/server.js');

describe('isAllowedOrigin', () => {
  it('allows requests with no Origin header', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it('allows every origin listed in FRONTEND_URL', () => {
    expect(isAllowedOrigin('http://localhost:3001')).toBe(true);
    expect(isAllowedOrigin('https://app.example.com')).toBe(true);
  });

  it('allows any localhost port outside production', () => {
    expect(isAllowedOrigin('http://localhost:3011')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  it('rejects other origins', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://notlocalhost:3011')).toBe(false);
  });

  it('rejects unlisted localhost ports in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(isAllowedOrigin('http://localhost:3011')).toBe(false);
      expect(isAllowedOrigin('http://localhost:3001')).toBe(true);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
