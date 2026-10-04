// Events page — /organizations/[orgId]/events (and /events on a tenant host).
// Spec 038 D5: today's organization home becomes the Events template; the
// homepage `/` is the organizer's own page once saved. Organizations outside
// the themes rollout get today's storefront here too.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import { organizationPath } from '@/lib/publicPaths';
import OrganizationStorefront from '../OrganizationStorefront';
import ThemedStorefront from '@/theme/ThemedStorefront';
import { loadStorefrontFrame } from '@/theme/server/storefront';

interface StorefrontMeta {
  slug: string;
  name: string;
  title: string;
  description: string | null;
}

const metaFor = (orgId: string) =>
  fetchPublicJson<StorefrontMeta>(`/organizations/${encodeURIComponent(orgId)}/public/meta`);

export async function generateMetadata({ params }: { params: { orgId: string } }): Promise<Metadata> {
  const meta = await metaFor(params.orgId);
  if (!meta) return {};
  return {
    title: `Events · ${meta.name}`,
    description: meta.description ?? undefined,
    openGraph: { title: `Events · ${meta.name}`, description: meta.description ?? undefined, siteName: meta.name },
  };
}

export default async function OrganizationEventsPage({
  params,
  searchParams = {},
}: {
  params: { orgId: string };
  searchParams?: Record<string, string | undefined>;
}) {
  const meta = await metaFor(params.orgId);
  if (meta?.slug && meta.slug !== params.orgId && !headers().get('x-jump-tenant-host')) {
    permanentRedirect(`${organizationPath(meta.slug)}/events`);
  }
  const frame = await loadStorefrontFrame(params.orgId, 'events');
  if (frame.kind === 'legacy') return <OrganizationStorefront orgId={params.orgId} />;
  return <ThemedStorefront frame={frame} nameIsHeading path={`/organizations/${params.orgId}/events`} query={searchParams} />;
}
