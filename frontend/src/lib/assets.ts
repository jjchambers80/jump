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
  return resolveAssetUrl(swapped);
}
