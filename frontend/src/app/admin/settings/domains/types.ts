// Settings › Domains (spec 008). Mirrors DomainService.serialize on the backend.

export type DomainStatus = 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'FAILED';
export type RecordStatus = 'pending' | 'valid' | 'invalid' | 'missing';
export type CertificateStatus = 'PENDING' | 'ISSUED' | 'FAILED';

export interface DnsRecord {
  key: 'cname' | 'txt';
  type: 'CNAME' | 'TXT';
  /** Fully qualified record name. */
  name: string;
  /** Required value. */
  value: string;
  /** What DNS answered at the last check; null before any check or when absent. */
  currentValue: string | null;
  status: RecordStatus;
}

export interface DnsProvider {
  key: string;
  name: string;
  dnsConsoleUrl: string;
  supportsApexCname: boolean;
}

export interface StorefrontDomain {
  id: string;
  hostname: string;
  /** Registrable zone (example.com) — where the DNS records live. */
  zone: string;
  status: DomainStatus;
  isPrimary: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  failingSince: string | null;
  lastError: string | null;
  createdAt: string;
  dnsRecords: DnsRecord[];
  tlsManagedByRailway: boolean;
  /** null when the certificate is not managed through Railway. */
  certificateStatus: CertificateStatus | null;
  dnsProvider: DnsProvider | null;
}

export interface DomainListResponse {
  domains: StorefrontDomain[];
  /** The organization's storefront on the platform host — always connected. */
  platformUrl: string;
}

/** Shopify-style status label + pill classes for a domain. */
export const STATUS_LABEL: Record<DomainStatus, string> = {
  PENDING: 'Needs setup',
  VERIFIED: 'Verifying',
  ACTIVE: 'Connected',
  FAILED: 'Failed',
};

export const STATUS_STYLE: Record<DomainStatus, string> = {
  PENDING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  VERIFIED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

/**
 * Record name relative to the zone, the form every DNS console asks for
 * ("tickets", "_jump-verify.tickets"). Falls back to the FQDN when the name
 * is not inside the zone.
 */
export function relativeName(name: string, zone: string): string {
  if (name === zone) return '@';
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
}

/**
 * Client-side mirror of the backend's normalizeHostname: enough to give
 * inline feedback for the common slips (scheme, path, an email address, an
 * apex domain). The server stays authoritative.
 */
export function hostnameError(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return 'Enter the domain you want to connect.';
  if (raw.includes('@')) return 'Enter a domain, not an email address.';
  const host = raw.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split(':')[0].replace(/\.$/, '');
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    return 'Enter a hostname like tickets.yourvenue.com.';
  }
  if (host.split('.').length < 3) {
    return 'Use a subdomain such as tickets.yourvenue.com. Root domains are not supported yet.';
  }
  return null;
}
