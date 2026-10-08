// Card thumbnail of a draft theme's home page (spec 038 contracts C7): the
// Online Store page frames it, scaled down. The signed `t` token is the only
// credential, so it never reads or sets cookies; anything else is a 404.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ThemedStorefront from '@/theme/ThemedStorefront';
import { loadStorefrontFrame } from '@/theme/server/storefront';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ThemeThumbnailPage({
  params,
  searchParams,
}: {
  params: { orgId: string };
  searchParams: { t?: string };
}) {
  if (!searchParams.t) notFound();
  const frame = await loadStorefrontFrame(params.orgId, 'home', { thumbnail: searchParams.t });
  if (frame.kind !== 'theme' || !frame.data.preview?.thumbnail) notFound();
  return <ThemedStorefront frame={frame} nameIsHeading overlayHeader path={`/organizations/${params.orgId}`} query={{}} />;
}
