// OAuth public-client registration and Client ID Metadata Documents (spec 045).
// CIMD URLs are fetched through a DNS-pinned HTTPS request: every resolved
// address is checked before the socket is opened, preventing DNS rebinding SSRF.

import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { prisma } from '@jump/db';

const CACHE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3_000;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_REDIRECT_URIS = 10;
const NAME_MAX = 100;

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10],
  ['ff00::', 8], ['64:ff9b::', 96], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
]) blocked.addSubnet(network, prefix, 'ipv6');

export class OAuthClientError extends Error {
  constructor(message, code = 'invalid_client_metadata') {
    super(message);
    this.name = 'OAuthClientError';
    this.code = code;
    this.statusCode = 400;
  }
}

function mappedV4(address) {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return match?.[1] ?? null;
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  const mapped = family === 6 ? mappedV4(address) : null;
  if (mapped) return !blocked.check(mapped, 'ipv4');
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export async function resolvePublicAddresses(hostname, resolver = lookup) {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new OAuthClientError('Client metadata host is not public');
    return [{ address: hostname, family: isIP(hostname) }];
  }
  let rows;
  try {
    rows = await resolver(hostname, { all: true, verbatim: true });
  } catch {
    throw new OAuthClientError('Client metadata host could not be resolved');
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.some(({ address }) => !isPublicAddress(address))) {
    throw new OAuthClientError('Client metadata host is not public');
  }
  return rows;
}

function pinnedHttpsJson(url, addresses, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_METADATA_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const target = addresses[0];
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };
    const deadline = setTimeout(() => {
      req.destroy(new OAuthClientError('Client metadata request timed out'));
    }, timeoutMs);
    const req = https.request(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'Jump-OAuth-CIMD/1.0' },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        finish(reject, new OAuthClientError('Client metadata document was not found'));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        finish(reject, new OAuthClientError('Client metadata document is too large'));
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy(new OAuthClientError('Client metadata document is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          finish(reject, new OAuthClientError('Client metadata document is not valid JSON'));
        }
      });
      res.on('error', (error) => finish(reject, error));
    });
    req.on('error', (error) => finish(reject, error instanceof OAuthClientError ? error : new OAuthClientError('Client metadata request failed')));
    req.end();
  });
}

function cleanRedirectUris(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS) {
    throw new OAuthClientError('redirect_uris must contain between 1 and 10 URLs');
  }
  const uris = [...new Set(value)];
  for (const uri of uris) {
    if (typeof uri !== 'string' || uri.length > 2048) throw new OAuthClientError('A redirect URI is invalid');
    let parsed;
    try { parsed = new URL(uri); } catch { throw new OAuthClientError('A redirect URI is invalid'); }
    if (parsed.username || parsed.password || parsed.hash) throw new OAuthClientError('A redirect URI is invalid');
    const loopback = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !loopback) throw new OAuthClientError('Redirect URIs must use HTTPS or a loopback address');
  }
  return uris;
}

function normalizeMetadata(metadata, expectedClientId = null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new OAuthClientError('Client metadata is invalid');
  if (expectedClientId && metadata.client_id !== expectedClientId) {
    throw new OAuthClientError('Client metadata client_id must match its document URL');
  }
  if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== 'none') {
    throw new OAuthClientError('Only public clients are supported');
  }
  if (metadata.grant_types && (
    !Array.isArray(metadata.grant_types) ||
    metadata.grant_types.some((value) => !['authorization_code', 'refresh_token'].includes(value))
  )) throw new OAuthClientError('Only authorization_code and refresh_token grants are supported');
  if (metadata.response_types && (
    !Array.isArray(metadata.response_types) || metadata.response_types.some((value) => value !== 'code')
  )) throw new OAuthClientError('Only the code response type is supported');
  return {
    name: (typeof metadata.client_name === 'string' && metadata.client_name.trim()
      ? metadata.client_name.trim()
      : 'OAuth client').slice(0, NAME_MAX),
    redirectUris: cleanRedirectUris(metadata.redirect_uris),
  };
}

export function isLoopbackRedirect(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'http:' && Boolean(url.port) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username && !url.password && !url.hash;
  } catch { return false; }
}


function sameLoopbackExceptPort(registered, requested) {
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    if (!isLoopbackRedirect(requested)) return false;
    return a.protocol === 'http:' && a.hostname === b.hostname &&
      a.pathname === b.pathname && a.search === b.search && !a.hash && !b.hash;
  } catch { return false; }
}

export function redirectAllowed(client, redirectUri) {
  if (typeof redirectUri !== 'string') return false;
  if (client.redirectUris.includes(redirectUri)) return true;
  return client.redirectUris.some((registered) => sameLoopbackExceptPort(registered, redirectUri));
}

class OAuthClientService {
  async fetchCimd(clientId, { resolver = lookup, requester = pinnedHttpsJson } = {}) {
    let url;
    try { url = new URL(clientId); } catch { throw new OAuthClientError('Unknown OAuth client', 'invalid_client'); }
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash || url.href !== clientId) {
      throw new OAuthClientError('Client ID metadata must be a canonical HTTPS URL', 'invalid_client');
    }
    const addresses = await resolvePublicAddresses(url.hostname, resolver);
    const metadata = await requester(url, addresses, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_METADATA_BYTES });
    return normalizeMetadata(metadata, clientId);
  }

  async resolve(clientId, options = {}) {
    if (typeof clientId !== 'string' || !clientId || clientId.length > 2048) {
      throw new OAuthClientError('Unknown OAuth client', 'invalid_client');
    }
    const existing = await prisma.oAuthClient.findUnique({ where: { clientId } });
    if (existing?.kind !== 'CIMD') return existing ?? this.fetchAndStore(clientId, options);
    if (existing.metadataFetchedAt && Date.now() - existing.metadataFetchedAt.getTime() < CACHE_MS) return existing;
    return this.fetchAndStore(clientId, options);
  }

  async fetchAndStore(clientId, options = {}) {
    const data = await this.fetchCimd(clientId, options);
    return prisma.oAuthClient.upsert({
      where: { clientId },
      update: { ...data, metadataFetchedAt: new Date() },
      create: { clientId, kind: 'CIMD', ...data, metadataFetchedAt: new Date() },
    });
  }

  async register(metadata) {
    const data = normalizeMetadata(metadata);
    const clientId = `jmp_client_${randomBytes(24).toString('base64url')}`;
    return prisma.oAuthClient.create({ data: { clientId, kind: 'DCR', ...data } });
  }
}

export default new OAuthClientService();
