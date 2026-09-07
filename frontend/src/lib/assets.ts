export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export function resolveAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  return `${API_URL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}
