import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { API_URL, resolveAssetUrl } from '../../../lib/assets';
import { organizationPath } from '@/lib/publicPaths';
import OrganizationStorefront from './OrganizationStorefront';

interface StorefrontMeta {
  id: string;
  slug: string;
  name: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
}

async function getStorefrontMeta(orgId: string): Promise<StorefrontMeta | null> {
  try {
    const res = await fetch(`${API_URL}/organizations/${encodeURIComponent(orgId)}/public/meta`, {
      signal: AbortSignal.timeout(2000),
      next: { revalidate: 60 },
    });
    return res.ok ? ((await res.json()) as StorefrontMeta) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { orgId: string } }): Promise<Metadata> {
  const meta = await getStorefrontMeta(params.orgId);
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

export default async function OrganizationPage({ params }: { params: { orgId: string } }) {
  const meta = await getStorefrontMeta(params.orgId);
  if (meta?.slug && meta.slug !== params.orgId && !headers().get('x-jump-tenant-host')) {
    permanentRedirect(organizationPath(meta.slug));
  }
  return <OrganizationStorefront orgId={params.orgId} />;
}