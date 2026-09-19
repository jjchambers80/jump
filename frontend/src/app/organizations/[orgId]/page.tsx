// Public organization storefront — /organizations/[orgId] (and `/` on a
// tenant host). Server wrapper: the homepage <title>, meta description and
// sharing image come from Online store › Preferences; the page itself is the
// client component.

import type { Metadata } from 'next';
import { API_URL, resolveAssetUrl } from '../../../lib/assets';
import OrganizationStorefront from './OrganizationStorefront';

interface StorefrontMeta {
  id: string;
  name: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
}

export async function generateMetadata({ params }: { params: { orgId: string } }): Promise<Metadata> {
  let meta: StorefrontMeta | null = null;
  try {
    const res = await fetch(`${API_URL}/organizations/${encodeURIComponent(params.orgId)}/public/meta`, {
      signal: AbortSignal.timeout(2000),
      next: { revalidate: 60 },
    });
    if (res.ok) meta = (await res.json()) as StorefrontMeta;
  } catch {
    meta = null; // backend unreachable or unknown org: keep the app defaults
  }
  if (!meta) return {};

  const image = resolveAssetUrl(meta.imageUrl);
  return {
    title: meta.title,
    description: meta.description ?? undefined,
    openGraph: {
      title: meta.title,
      description: meta.description ?? undefined,
      siteName: meta.name,
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default function OrganizationPage({ params }: { params: { orgId: string } }) {
  return <OrganizationStorefront orgId={params.orgId} />;
}
