import { describe, expect, it, jest } from '@jest/globals';
import oAuthClientService, {
  OAuthClientError,
  isPublicAddress,
  redirectAllowed,
  resolvePublicAddresses,
} from '../../src/services/OAuthClientService.js';

describe('OAuthClientService SSRF and redirects', () => {
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '10.12.0.4',
    '172.20.1.1',
    '192.168.1.5',
    '::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('refuses non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('accepts public IPv4 and IPv6 addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it.each(['127.0.0.1', '169.254.169.254', '10.0.0.9'])(
    'blocks %s before the metadata requester runs',
    async (address) => {
      const requester = jest.fn();
      await expect(oAuthClientService.fetchCimd(`https://${address}/client.json`, {
        resolver: jest.fn(),
        requester,
      })).rejects.toBeInstanceOf(OAuthClientError);
      expect(requester).not.toHaveBeenCalled();
    }
  );

  it('rejects a hostname if any DNS answer is private', async () => {
    const resolver = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(resolvePublicAddresses('client.example', resolver)).rejects.toThrow('not public');
  });

  it('pins the checked addresses and validates the CIMD client id', async () => {
    const resolver = jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const requester = jest.fn().mockResolvedValue({
      client_id: 'https://client.example/oauth.json',
      client_name: 'Example agent',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
    });
    await expect(oAuthClientService.fetchCimd('https://client.example/oauth.json', {
      resolver,
      requester,
    })).resolves.toEqual({
      name: 'Example agent',
      redirectUris: ['https://client.example/callback'],
    });
    expect(requester.mock.calls[0][1]).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('matches exact HTTPS callbacks and only varies loopback ports', () => {
    const client = { redirectUris: ['https://client.example/callback', 'http://127.0.0.1/callback'] };
    expect(redirectAllowed(client, 'https://client.example/callback')).toBe(true);
    expect(redirectAllowed(client, 'https://client.example/callback/')).toBe(false);
    expect(redirectAllowed(client, 'http://127.0.0.1:54321/callback')).toBe(true);
    expect(redirectAllowed(client, 'http://127.0.0.1:54321/other')).toBe(false);
  });

  it('does not grant hosted callbacks to an unrelated client', () => {
    const client = { redirectUris: ['https://client.example/callback'] };
    expect(redirectAllowed(client, 'https://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(redirectAllowed(client, 'https://chatgpt.com/connector_platform_oauth_redirect')).toBe(false);
  });
});
