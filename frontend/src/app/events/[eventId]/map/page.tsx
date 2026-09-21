import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { eventPath } from '@/lib/publicPaths';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import PublicMapClient from './PublicMapClient';

export default async function PublicMapPage({ params }: { params: { eventId: string } }) {
  const route = await fetchPublicJson<{ slug: string }>(
    `/events/${encodeURIComponent(params.eventId)}/meta`
  );
  if (
    route?.slug &&
    route.slug !== params.eventId &&
    !headers().get('x-jump-tenant-host')
  ) {
    permanentRedirect(`${eventPath(route.slug)}/map`);
  }
  return <PublicMapClient params={params} />;
}