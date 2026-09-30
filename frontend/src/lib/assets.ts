export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export function resolveAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  return `${API_URL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

/**
 * Swap an image's `original` serving URL (`/images/:id/:hash/original`) for
 * one of the backend's resized variants (ImageService VARIANTS: thumb 128²,
 * card 400×300, hero 1200×630). Any other URL (public bucket, legacy upload,
 * external link) is returned unchanged, so callers still get a usable image.
 */
export function imageVariantUrl(
  url: string | null | undefined,
  variant: 'thumb' | 'card' | 'hero'
): string | null {
  if (!url) return null;
  const swapped = url.replace(/(\/images\/[^/]+\/[^/]+\/)original(?=$|[?#])/, `$1${variant}`);
  // The original's `?w=&h=` describes the original, not a resized variant.
  return resolveAssetUrl(swapped === url ? url : withoutDimensions(swapped));
}

/**
 * Pixel size an image URL carries as `?w=&h=` (ImageService.dimensionQuery on
 * the backend, or `withImageDimensions`). Lets an `<img>` reserve its box
 * before the bytes arrive, so nothing around it jumps. Null when absent.
 */
export function imageDimensions(url: string | null | undefined): { width: number; height: number } | null {
  if (!url) return null;
  const query = url.split('#')[0].split('?')[1];
  if (!query) return null;
  const params = new URLSearchParams(query);
  const width = Number(params.get('w'));
  const height = Number(params.get('h'));
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}

/** Add `?w=&h=` to an image URL (theme files know their size from the API). */
export function withImageDimensions(url: string, width?: number | null, height?: number | null): string {
  if (!width || !height || imageDimensions(url)) return url;
  const [path, hash] = url.split('#');
  return `${path}${path.includes('?') ? '&' : '?'}w=${width}&h=${height}${hash !== undefined ? `#${hash}` : ''}`;
}

function withoutDimensions(url: string): string {
  const [path, hash] = url.split('#');
  const [base, query] = path.split('?');
  if (!query) return url;
  const params = new URLSearchParams(query);
  params.delete('w');
  params.delete('h');
  const rest = params.toString();
  return `${base}${rest ? `?${rest}` : ''}${hash !== undefined ? `#${hash}` : ''}`;
}
