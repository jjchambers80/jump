// Public page — /organizations/[orgId]/pages/[slug] (and /pages/[slug] on a tenant host).

import type { Metadata } from 'next';
import StorefrontPageView from '@/components/storefront/StorefrontPageView';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import StorefrontPageBody, { type PublicPage } from '@/components/storefront/StorefrontPageBody';
import ThemedContentPage from '@/theme/ThemedContentPage';
import { loadStorefrontFrame } from '@/theme/server/storefront';

type Params = { orgId: string; slug: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await fetchPublicJson<{
    organization: { name: string };
    page: { title: string; seoTitle: string | null; seoDescription: string | null };
  }>(
    `/organizations/${encodeURIComponent(params.orgId)}/public/pages/${encodeURIComponent(params.slug)}`
  );
  if (!data) return {};
  const title = data.page.seoTitle || data.page.title;
  return {
    title: `${title} · ${data.organization.name}`,
    description: data.page.seoDescription ?? undefined,
    openGraph: {
      title,
      description: data.page.seoDescription ?? undefined,
      siteName: data.organization.name,
    },
  };
}

export default async function StorefrontPage({ params }: { params: Params }) {
  const frame = await loadStorefrontFrame(params.orgId, 'frame');
  if (frame.kind === 'legacy') return <StorefrontPageView orgId={params.orgId} slug={params.slug} />;
  return (
    <ThemedContentPage<{ page: PublicPage }>
      frame={frame}
      path={`/organizations/${encodeURIComponent(params.orgId)}/public/pages/${encodeURIComponent(params.slug)}`}
      notFoundTitle="Page not found"
    >
      {({ page }) => <StorefrontPageBody page={page} />}
    </ThemedContentPage>
  );
}
