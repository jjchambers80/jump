import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import { venuePath } from '@/lib/publicPaths';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import VenueDetailClient from './VenueDetailClient';

export default async function PublicVenuePage({ params }: { params: { venueId: string } }) {
  const route = await fetchPublicJson<{ slug: string }>(
    `/venues/${encodeURIComponent(params.venueId)}/meta`
  );
  if (
    route?.slug &&
    route.slug !== params.venueId &&
    !headers().get('x-jump-tenant-host')
  ) {
    permanentRedirect(venuePath(route.slug));
  }
  return <VenueDetailClient params={params} />;
}
