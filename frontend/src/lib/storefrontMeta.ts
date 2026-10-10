// Server-side metadata for public content pages. Unauthenticated fetch with a
// short timeout; a private store (403) or unknown record leaves the defaults.

import type { Metadata } from 'next';
import { API_URL, resolveAssetUrl } from './assets';

// Server-only, like theme/server/storefront.ts: the private backend URL when set.
const SERVER_API_URL = process.env.INTERNAL_API_URL || API_URL;

/** `headers` (a per-visitor answer, e.g. a draft preview) skips the shared 60 s cache. */
export async function fetchPublicJson<T>(path: string, headers?: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      signal: AbortSignal.timeout(2000),
      ...(headers ? { headers, cache: 'no-store' as const } : { next: { revalidate: 60 } }),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function articleMetadata(input: {
  title: string;
  description: string | null;
  siteName: string;
  imageUrl?: string | null;
  publishedAt?: string | null;
}): Metadata {
  const image = resolveAssetUrl(input.imageUrl ?? null);
  return {
    title: `${input.title} · ${input.siteName}`,
    description: input.description ?? undefined,
    openGraph: {
      type: 'article',
      title: input.title,
      description: input.description ?? undefined,
      siteName: input.siteName,
      ...(input.publishedAt ? { publishedTime: input.publishedAt } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

/**
 * Spec 049 favicon for every storefront page of an organization: the backend
 * resolves the square logo (`/public/meta` faviconUrl).
 * None: no `icons`, so the platform default stays.
 */
export function faviconMetadata(faviconUrl: string | null | undefined): Metadata {
  // The square logo is already the 512² `square` variant.
  const url = resolveAssetUrl(faviconUrl ?? null);
  return url ? { icons: { icon: url, apple: url } } : {};
}
