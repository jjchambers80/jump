// Content › URL redirects (spec 028): path rules shared by the validator,
// the service and the public lookup.

export const REDIRECT_PATH_MAX = 255;
export const REDIRECT_TARGET_MAX = 2048;
export const REDIRECTS_PER_ORG_MAX = 5000;

// Live storefront routes on a tenant host (mirrors frontend/src/lib/storefrontHost.ts).
const RESERVED = [
  /^\/$/,
  /^\/account(\/|$)/,
  /^\/events(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/orders(\/|$)/,
  /^\/venues(\/|$)/,
  /^\/tickets(\/|$)/,
  /^\/confirmation$/,
  /^\/api(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/organizations(\/|$)/,
  /^\/rsvp(\/|$)/,
  /^\/_next(\/|$)/,
];

/** Lowercase, leading "/", no trailing "/" (except root), no query / hash. */
export function normalizeFromPath(raw) {
  let path = String(raw ?? '').trim();
  if (!path) return '';
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return '';
  }
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.split(/[?#]/)[0].toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path.replace(/\/{2,}/g, '/');
}

export function isReservedPath(path) {
  return RESERVED.some((re) => re.test(path));
}

/** Absolute http(s) URL, or a relative storefront path. Returns the cleaned value or null. */
export function normalizeToPath(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value.length > REDIRECT_TARGET_MAX) return null;
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).toString();
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // javascript:, data:, mailto:…
  const path = value.startsWith('/') ? value : `/${value}`;
  return /^\/[^\s]*$/.test(path) ? path : null;
}

export function isAbsoluteTarget(toPath) {
  return /^https?:\/\//i.test(toPath);
}
