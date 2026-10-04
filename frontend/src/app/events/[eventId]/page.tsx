import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { eventPath } from '@/lib/publicPaths';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import ThemedStorefront from '@/theme/ThemedStorefront';
import { loadStorefrontFrame } from '@/theme/server/storefront';
import EventDetailClient from './EventDetailClient';

export default async function EventDetailPage({ params }: { params: { eventId: string } }) {
  const route = await fetchPublicJson<{ slug: string; organizationId?: string }>(
    `/events/${encodeURIComponent(params.eventId)}/meta`
  );
  if (
    route?.slug &&
    route.slug !== params.eventId &&
    !headers().get('x-jump-tenant-host')
  ) {
    permanentRedirect(eventPath(route.slug));
  }
  // Themed organizations: the theme's header and footer frame the event page,
  // exactly as on the home, events, pages and blog routes, so the header is
  // the same everywhere. A locked store or legacy org keeps the client page,
  // which runs its own gate (the renderer switch never takes a page down).
  const frame = route?.organizationId ? await loadStorefrontFrame(route.organizationId, 'frame') : null;
  if (frame?.kind === 'theme') {
    return (
      <ThemedStorefront frame={frame} path={eventPath(route?.slug ?? params.eventId)}>
        <EventDetailClient params={params} chrome={false} />
      </ThemedStorefront>
    );
  }
  return <EventDetailClient params={params} />;
}
