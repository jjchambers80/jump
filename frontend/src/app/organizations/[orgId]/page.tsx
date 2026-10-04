import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { API_URL, resolveAssetUrl } from '../../../lib/assets';
import { organizationPath } from '@/lib/publicPaths';
import OrganizationStorefront from './OrganizationStorefront';
import ThemedStorefront from '@/theme/ThemedStorefront';
import { loadStorefrontFrame } from '@/theme/server/storefront';

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

export default async function OrganizationPage({
  params,
  searchParams = {},
}: {
  params: { orgId: string };
  searchParams?: Record<string, string | undefined>;
}) {
  const meta = await getStorefrontMeta(params.orgId);
  if (meta?.slug && meta.slug !== params.orgId && !headers().get('x-jump-tenant-host')) {
    permanentRedirect(organizationPath(meta.slug));
  }
  // Spec 038: organizations in the themes rollout render on the server; every
  // other organization (and any failure) keeps the client storefront. `/`
  // shows the saved homepage, else the Events page (D5, decided by the backend).
  const frame = await loadStorefrontFrame(params.orgId, 'home');
  if (frame.kind === 'legacy') return <OrganizationStorefront orgId={params.orgId} />;
  return <ThemedStorefront frame={frame} nameIsHeading path={`/organizations/${params.orgId}`} query={searchParams} />;
}