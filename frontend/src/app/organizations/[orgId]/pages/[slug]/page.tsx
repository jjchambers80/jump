// Public page — /organizations/[orgId]/pages/[slug] (and /pages/[slug] on a tenant host).

import type { Metadata } from 'next';
import StorefrontPageView from '@/components/storefront/StorefrontPageView';
import { fetchPublicJson } from '@/lib/storefrontMeta';
import StorefrontPageBody, { type PublicPage } from '@/components/storefront/StorefrontPageBody';
import ThemedContentPage from '@/theme/ThemedContentPage';
import ThemedStorefront from '@/theme/ThemedStorefront';
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
  const pagePath = `/organizations/${params.orgId}/pages/${params.slug}`;
  // One call: the frame plus the page (`resolved.page`), and for a full-width
  // page its theme document as the body.
  const themed = await loadStorefrontFrame(params.orgId, `page:${params.slug}`);
  if (themed.kind === 'locked') return <ThemedStorefront frame={themed} path={pagePath} />;
  if (themed.kind === 'theme' && themed.data.resolved.page) {
    const { page } = themed.data.resolved;
    if (themed.data.documents.template) return <ThemedStorefront frame={themed} path={pagePath} />;
    return (
      <ThemedStorefront frame={themed} path={pagePath}>
        <StorefrontPageBody page={page} organizationId={themed.data.organization.id} />
      </ThemedStorefront>
    );
  }
  // Legacy organization, or no such page: the frame-only path renders the themed 404.
  const frame = await loadStorefrontFrame(params.orgId, 'frame');
  if (frame.kind === 'legacy') return <StorefrontPageView orgId={params.orgId} slug={params.slug} />;
  return (
    <ThemedContentPage<{ organization: { id: string }; page: PublicPage }>
      frame={frame}
      pagePath={pagePath}
      path={`/organizations/${encodeURIComponent(params.orgId)}/public/pages/${encodeURIComponent(params.slug)}`}
      notFoundTitle="Page not found"
    >
      {({ organization, page }) => <StorefrontPageBody page={page} organizationId={organization.id} />}
    </ThemedContentPage>
  );
}
