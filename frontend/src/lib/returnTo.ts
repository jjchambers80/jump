// `?returnTo=` on admin pages opened from the setup wizard (spec 050-M): only a
// same-origin `/admin` path is honoured, so the parameter can never become an
// open redirect (external, protocol-relative, `javascript:`, `..` escapes).

const BASE = 'http://returnto.invalid';

/** The normalised `/admin…` path (with query and hash), or null when it is not one. */
export function safeAdminReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return null;
  return url.pathname + url.search + url.hash;
}
