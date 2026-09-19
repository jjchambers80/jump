// Server-side metadata for public content pages. Unauthenticated fetch with a
// short timeout; a private store (403) or unknown record leaves the defaults.

import type { Metadata } from 'next';
import { API_URL, resolveAssetUrl } from './assets';

export async function fetchPublicJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      signal: AbortSignal.timeout(2000),
      next: { revalidate: 60 },
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
