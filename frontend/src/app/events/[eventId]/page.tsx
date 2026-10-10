import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { permanentRedirect, redirect } from 'next/navigation';
import { eventPath } from '@/lib/publicPaths';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import { EVENT_PREVIEW_COOKIE, EVENT_PREVIEW_HEADER } from '@/lib/eventPreview';
import ThemedStorefront from '@/theme/ThemedStorefront';
import { loadStorefrontFrame } from '@/theme/server/storefront';
import EventDetailClient from './EventDetailClient';

/** Draft preview token (spec 050 F), forwarded as-is: only the backend verifies it. */
function previewToken() {
  return cookies().get(EVENT_PREVIEW_COOKIE)?.value || undefined;
}

// A visitor holding a preview cookie may be looking at a draft: never index it.
export function generateMetadata(): Metadata {
  return previewToken() ? { robots: { index: false, follow: false } } : {};
}

export default async function EventDetailPage({ params }: { params: { eventId: string } }) {
  const preview = previewToken();
  const route = await fetchPublicJson<{ slug: string; organizationId?: string }>(
    `/events/${encodeURIComponent(params.eventId)}/meta`,
    preview ? { [EVENT_PREVIEW_HEADER]: preview } : undefined
  );
  if (
    route?.slug &&
    route.slug !== params.eventId &&
    !headers().get('x-jump-tenant-host')
  ) {
    // A draft's slug can still change: never let the browser cache that redirect.
    (preview ? redirect : permanentRedirect)(eventPath(route.slug));
  }
  // Themed organizations: the theme's header and footer frame the event page,
  // exactly as on the home, events, pages and blog routes, so the header is
  // the same everywhere. A locked store or legacy org keeps the client page,
  // which runs its own gate (the renderer switch never takes a page down).
  const frame = route?.organizationId ? await loadStorefrontFrame(route.organizationId, 'frame') : null;
  if (frame?.kind === 'theme') {
    return (
      <ThemedStorefront frame={frame} path={eventPath(route?.slug ?? params.eventId)}>
        <EventDetailClient params={params} chrome={false} previewToken={preview} />
      </ThemedStorefront>
    );
  }
  return <EventDetailClient params={params} previewToken={preview} />;
}
