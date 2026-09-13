import { describe, expect, it } from 'vitest';
import {
  CLAIMS_REFRESH_MS,
  applyUserClaims,
  shouldRefreshClaims,
  type ClaimsToken,
} from '@/lib/sessionClaims';

const NOW = 1_700_000_000_000;

describe('shouldRefreshClaims', () => {
  it('refreshes tokens minted before claimsRefreshedAt existed', () => {
    expect(shouldRefreshClaims({ sub: 'u1', role: 'ADMIN' }, NOW)).toBe(true);
  });

  it('skips tokens refreshed within the window', () => {
    const token: ClaimsToken = { sub: 'u1', claimsRefreshedAt: NOW - CLAIMS_REFRESH_MS + 1 };
    expect(shouldRefreshClaims(token, NOW)).toBe(false);
  });

  it('refreshes once the window has elapsed', () => {
    const token: ClaimsToken = { sub: 'u1', claimsRefreshedAt: NOW - CLAIMS_REFRESH_MS };
    expect(shouldRefreshClaims(token, NOW)).toBe(true);
  });

  it('never refreshes a token without a subject', () => {
    expect(shouldRefreshClaims({ claimsRefreshedAt: 0 }, NOW)).toBe(false);
  });

  it('treats a malformed claimsRefreshedAt as stale', () => {
    expect(shouldRefreshClaims({ sub: 'u1', claimsRefreshedAt: 'yesterday' }, NOW)).toBe(true);
  });
});

describe('applyUserClaims', () => {
  it('overwrites role and org from the DB snapshot and stamps the time', () => {
    const token: ClaimsToken = { sub: 'u1', role: 'ADMIN', organizationId: null, claimsRefreshedAt: 0 };
    applyUserClaims(token, { role: 'SYSTEM_ADMIN', name: 'JJ', email: 'jj@example.com', organizationId: 'org1' }, NOW);
    expect(token).toEqual({
      sub: 'u1',
      role: 'SYSTEM_ADMIN',
      name: 'JJ',
      email: 'jj@example.com',
      organizationId: 'org1',
      claimsRefreshedAt: NOW,
    });
  });

  it('clears an org the user no longer belongs to', () => {
    const token: ClaimsToken = { sub: 'u1', organizationId: 'org1' };
    applyUserClaims(token, { role: 'ORGANIZER', name: null, email: 'o@example.com', organizationId: null }, NOW);
    expect(token.organizationId).toBeNull();
  });
});
