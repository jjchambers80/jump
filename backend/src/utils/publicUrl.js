// Public base URL of this backend, used to make relative asset URLs
// (e.g. /images/:id/:hash/:variant) absolute outside the app — emails,
// CSV exports. BACKEND_URL wins; Railway exposes RAILWAY_PUBLIC_DOMAIN
// automatically.

export function backendPublicUrl() {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function absoluteAssetUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${backendPublicUrl()}/${url.replace(/^\//, '')}`;
}
