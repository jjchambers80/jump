// Menu hrefs come from the backend in platform form (/organizations/:id/...).
// On a tenant host (custom domain) the same pages live at short paths, so
// links are rewritten client-side; platform hosts keep them as-is.

import { isPlatformHost, platformHostsFromEnv } from './storefrontHost';

// Next inlines NEXT_PUBLIC_* only when read by full name, so list them here.
const PLATFORM_HOSTS = platformHostsFromEnv({
  NEXT_PUBLIC_PLATFORM_HOSTS: process.env.NEXT_PUBLIC_PLATFORM_HOSTS,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

export function isTenantHost(host: string | null | undefined) {
  if (!host) return false;
  return !isPlatformHost(host, PLATFORM_HOSTS);
}

export function storefrontHref(href: string, orgId: string, host?: string | null) {
  const current = host ?? (typeof window === 'undefined' ? null : window.location.host);
  if (!isTenantHost(current)) return href;
  const prefix = `/organizations/${orgId}`;
  if (href === prefix) return '/';
  if (href.startsWith(`${prefix}#`)) return `/${href.slice(prefix.length)}`;
  if (href.startsWith(`${prefix}/`)) return href.slice(prefix.length);
  return href;
}
