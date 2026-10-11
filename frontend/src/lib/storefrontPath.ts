// Menu hrefs come from the backend in platform form (/organizations/:slug/...).
// On a tenant host (custom domain or store subdomain) the same pages live at short paths, so
// links are rewritten client-side; platform hosts keep them as-is.

import { isPlatformHost, platformHostsFromEnv } from './storefrontHost';

// Next inlines NEXT_PUBLIC_* only when read by full name, so list them here.
const PLATFORM_HOSTS = platformHostsFromEnv({
  NEXT_PUBLIC_PLATFORM_HOSTS: process.env.NEXT_PUBLIC_PLATFORM_HOSTS,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

export function isTenantHost(host: string | null | undefined) {
  if (!host) return false;
  return !isPlatformHost(host, PLATFORM_HOSTS, process.env.NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN);
}

// A tenant host serves exactly one organization, so any /organizations/:idOrSlug prefix
// is that organization: menu and theme links name it by slug, routes by id.
export function storefrontHref(href: string, host?: string | null) {
  const current = host ?? (typeof window === 'undefined' ? null : window.location.host);
  if (!isTenantHost(current)) return href;
  const m = href.match(/^\/organizations\/[^/?#]+(.*)$/);
  if (!m) return href;
  return !m[1] || /^[?#]/.test(m[1]) ? `/${m[1]}` : m[1];
}
