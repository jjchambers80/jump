// Unit tests for WalletTokenService — per-ticket wallet access tokens + links

process.env.BACKEND_URL = 'https://api.example.com';

const { default: walletTokenService } = await import('../../../src/services/wallet/WalletTokenService.js');

describe('WalletTokenService', () => {
  it('issues a deterministic base64url token per ticket', () => {
    const a = walletTokenService.issue('ticket-a');
    const b = walletTokenService.issue('ticket-a');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('issues different tokens for different tickets', () => {
    expect(walletTokenService.issue('ticket-a')).not.toBe(walletTokenService.issue('ticket-b'));
  });

  it('verifies only the matching token', () => {
    const token = walletTokenService.issue('ticket-a');
    expect(walletTokenService.verify('ticket-a', token)).toBe(true);
    expect(walletTokenService.verify('ticket-b', token)).toBe(false);
    expect(walletTokenService.verify('ticket-a', token.slice(0, -1) + 'x')).toBe(false);
    expect(walletTokenService.verify('ticket-a', '')).toBe(false);
    expect(walletTokenService.verify('ticket-a', undefined)).toBe(false);
  });

  it('returns null links when no wallet provider is configured', () => {
    expect(walletTokenService.links({ id: 't1', status: 'VALID' })).toEqual({ apple: null, google: null });
  });

  it('returns null links for non-VALID tickets', () => {
    expect(walletTokenService.links({ id: 't1', status: 'REDEEMED' })).toEqual({ apple: null, google: null });
    expect(walletTokenService.links({ id: 't1', status: 'VOIDED' })).toEqual({ apple: null, google: null });
  });
});
