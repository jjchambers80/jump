// Fetch a public resource on behalf of an organizer (Content › Files ›
// Upload from URL) without letting the backend be pointed at itself, the
// Railway private network or cloud metadata endpoints. Every hop (including
// redirects) is resolved and checked before it is requested.

import dns from 'dns/promises';
import net from 'net';
import { ValidationError } from '../middleware/errorHandler.js';

const MAX_REDIRECTS = 3;

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function inRange(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
}

const PRIVATE_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

/** True when the address must never be fetched (loopback, private, link-local, metadata). */
export function isForbiddenAddress(address) {
  if (net.isIPv4(address)) return PRIVATE_V4.some((cidr) => inRange(address, cidr));
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    )
      return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isForbiddenAddress(mapped[1]);
    return false;
  }
  return true;
}

async function assertPublicUrl(rawUrl, lookup) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError('Enter a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Only http and https URLs are supported');
  }
  if (url.username || url.password)
    throw new ValidationError('URLs with credentials are not supported');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new ValidationError('That address is not reachable from here');
  }
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new ValidationError('Could not resolve that host');
      });
  if (!addresses.length || addresses.some(({ address }) => isForbiddenAddress(address))) {
    throw new ValidationError('That address is not reachable from here');
  }
  return url;
}

/**
 * @param {string} rawUrl
 * @param {{ maxBytes: number, timeoutMs?: number, lookup?: Function, fetchImpl?: Function }} options
 * @returns {Promise<{ buffer: Buffer, contentType: string | null, finalUrl: string }>}
 */
export async function fetchPublicResource(rawUrl, options) {
  const { maxBytes, timeoutMs = 15000 } = options;
  const lookup = options.lookup || ((host, opts) => dns.lookup(host, opts));
  const fetchImpl = options.fetchImpl || fetch;

  let url = await assertPublicUrl(rawUrl, lookup);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response;
      try {
        response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal });
      } catch (error) {
        if (error.name === 'AbortError') throw new ValidationError('The download timed out');
        throw new ValidationError('Could not download that URL');
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new ValidationError('Could not download that URL');
        url = await assertPublicUrl(new URL(location, url).toString(), lookup);
        continue;
      }
      if (!response.ok) throw new ValidationError(`The server answered ${response.status}`);

      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > maxBytes)
        throw new ValidationError(`File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);

      const chunks = [];
      let total = 0;
      const reader = response.body?.getReader?.();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new ValidationError(
              `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`
            );
          }
          chunks.push(Buffer.from(value));
        }
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes)
          throw new ValidationError(`File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
        chunks.push(buffer);
      }

      return {
        buffer: Buffer.concat(chunks),
        contentType: response.headers.get('content-type'),
        finalUrl: url.toString(),
      };
    }
    throw new ValidationError('Too many redirects');
  } finally {
    clearTimeout(timer);
  }
}
