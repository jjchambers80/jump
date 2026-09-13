// DNS provider detection (spec 008)
//
// Settings › Domains shows "Managed by <provider>" and a "Log in to <provider>"
// link on the setup page, the way Shopify does. We look up the NS records of
// the zone that contains the hostname and match the nameserver suffix against
// a small table. Best effort only: an unknown provider yields null and the UI
// falls back to "your DNS provider". Detection never gates verification.

import { promises as dns } from 'dns';

const LOOKUP_TIMEOUT_MS = 2000;

/** key -> display data. supportsApexCname is reserved for apex support (spec 008 phase C). */
export const PROVIDERS = {
  cloudflare: { name: 'Cloudflare', dnsConsoleUrl: 'https://dash.cloudflare.com/', supportsApexCname: true },
  godaddy: { name: 'GoDaddy', dnsConsoleUrl: 'https://dcc.godaddy.com/manage/dns', supportsApexCname: false },
  namecheap: { name: 'Namecheap', dnsConsoleUrl: 'https://ap.www.namecheap.com/domains/list/', supportsApexCname: true },
  networksolutions: { name: 'Network Solutions', dnsConsoleUrl: 'https://www.networksolutions.com/manage-it/', supportsApexCname: false },
  route53: { name: 'Amazon Route 53', dnsConsoleUrl: 'https://console.aws.amazon.com/route53/v2/hostedzones', supportsApexCname: false },
  dnsimple: { name: 'DNSimple', dnsConsoleUrl: 'https://dnsimple.com/dashboard', supportsApexCname: true },
  squarespace: { name: 'Squarespace Domains', dnsConsoleUrl: 'https://account.squarespace.com/domains', supportsApexCname: false },
  hover: { name: 'Hover', dnsConsoleUrl: 'https://www.hover.com/control_panel', supportsApexCname: false },
  namecom: { name: 'Name.com', dnsConsoleUrl: 'https://www.name.com/account/domain', supportsApexCname: false },
  porkbun: { name: 'Porkbun', dnsConsoleUrl: 'https://porkbun.com/account/domainsSpeedy', supportsApexCname: true },
  bluehost: { name: 'Bluehost', dnsConsoleUrl: 'https://my.bluehost.com/hosting/app#/domains', supportsApexCname: false },
  ionos: { name: 'IONOS', dnsConsoleUrl: 'https://my.ionos.com/domains', supportsApexCname: false },
  digitalocean: { name: 'DigitalOcean', dnsConsoleUrl: 'https://cloud.digitalocean.com/networking/domains', supportsApexCname: false },
  vercel: { name: 'Vercel', dnsConsoleUrl: 'https://vercel.com/dashboard/domains', supportsApexCname: true },
  bunny: { name: 'bunny.net', dnsConsoleUrl: 'https://dash.bunny.net/dns', supportsApexCname: true },
  azure: { name: 'Azure DNS', dnsConsoleUrl: 'https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Network%2FdnsZones', supportsApexCname: false },
  googlecloud: { name: 'Google Cloud DNS', dnsConsoleUrl: 'https://console.cloud.google.com/net-services/dns/zones', supportsApexCname: false },
};

// Nameserver hostname suffix -> provider key. Longest match wins.
const NS_SUFFIXES = [
  ['.ns.cloudflare.com', 'cloudflare'],
  ['.domaincontrol.com', 'godaddy'],
  ['.registrar-servers.com', 'namecheap'],
  ['.worldnic.com', 'networksolutions'],
  ['.netsol.com', 'networksolutions'],
  ['.awsdns-', 'route53'], // ns-123.awsdns-45.com — matched on the label, see below
  ['.dnsimple.com', 'dnsimple'],
  ['.dnsimple-edge.net', 'dnsimple'],
  ['.googledomains.com', 'squarespace'],
  ['.squarespacedns.com', 'squarespace'],
  ['.hover.com', 'hover'],
  ['.name.com', 'namecom'],
  ['.porkbun.com', 'porkbun'],
  ['.bluehost.com', 'bluehost'],
  ['.ui-dns.com', 'ionos'],
  ['.ui-dns.de', 'ionos'],
  ['.ui-dns.org', 'ionos'],
  ['.ui-dns.biz', 'ionos'],
  ['.digitalocean.com', 'digitalocean'],
  ['.vercel-dns.com', 'vercel'],
  ['.bunny.net', 'bunny'],
  ['.azure-dns.com', 'azure'],
  ['.azure-dns.net', 'azure'],
  ['.azure-dns.org', 'azure'],
  ['.azure-dns.info', 'azure'],
  ['.google.com', 'googlecloud'], // ns-cloud-a1.googledomains.com is Squarespace; ns-cloud-*.google.com is Cloud DNS
];

/** Provider key for a list of nameserver hostnames, or null. */
export function providerFromNameservers(nameservers) {
  for (const raw of nameservers || []) {
    const ns = String(raw).toLowerCase().replace(/\.$/, '');
    if (/\.awsdns-\d+\.(com|net|org|co\.uk)$/.test(ns)) return 'route53';
    for (const [suffix, key] of NS_SUFFIXES) {
      if (suffix.endsWith('-')) continue; // awsdns handled above
      if (ns.endsWith(suffix)) return key;
    }
  }
  return null;
}

/** Display data for a stored provider key; null for unknown/null keys. */
export function providerInfo(key) {
  if (!key || !PROVIDERS[key]) return null;
  return { key, ...PROVIDERS[key] };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Detect the DNS provider that serves the zone containing `hostname`.
 * Walks up from the hostname to its shortest two-label suffix and uses the
 * first NS answer. Returns a provider key or null; never throws.
 * @param {string} hostname
 * @param {{ resolveNs: (name: string) => Promise<string[]> }} [resolver] injectable for tests
 */
export async function detectDnsProvider(hostname, resolver = dns) {
  const labels = String(hostname || '').toLowerCase().split('.').filter(Boolean);
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join('.');
    try {
      const nameservers = await withTimeout(resolver.resolveNs(candidate), LOOKUP_TIMEOUT_MS);
      if (nameservers?.length) return providerFromNameservers(nameservers);
    } catch {
      // NXDOMAIN / no NS at this level: try the parent
    }
  }
  return null;
}
