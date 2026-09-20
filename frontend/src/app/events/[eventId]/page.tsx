import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { eventPath } from '@/lib/publicPaths';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import EventDetailClient from './EventDetailClient';

export default async function EventDetailPage({ params }: { params: { eventId: string } }) {
  const route = await fetchPublicJson<{ slug: string }>(
    `/events/${encodeURIComponent(params.eventId)}/meta`
  );
  if (
    route?.slug &&
    route.slug !== params.eventId &&
    !headers().get('x-jump-tenant-host')
  ) {
    permanentRedirect(eventPath(route.slug));
  }
  return <EventDetailClient params={params} />;
}
