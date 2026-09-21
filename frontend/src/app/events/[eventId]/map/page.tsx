import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { eventPath } from '@/lib/publicPaths';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import PublicMapClient from './PublicMapClient';

export default async function PublicMapPage({
  params,
  searchParams,
}: {
  params: { eventId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const route = await fetchPublicJson<{ slug: string }>(
    `/events/${encodeURIComponent(params.eventId)}/meta`
  );
  if (
    route?.slug &&
    route.slug !== params.eventId &&
    !headers().get('x-jump-tenant-host')
  ) {
    // Keep ?booth= (and anything else) across the slug redirect.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (typeof value === 'string') query.set(key, value);
    }
    const suffix = query.toString();
    permanentRedirect(`${eventPath(route.slug)}/map${suffix ? `?${suffix}` : ''}`);
  }
  return <PublicMapClient params={params} />;
}