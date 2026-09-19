'use client';

import ContentHtml from './ContentHtml';
import StorefrontShell, { type StorefrontOrganization } from './StorefrontShell';
import { useStorefrontContent } from './useStorefrontContent';

interface PagePayload {
  organization: StorefrontOrganization;
  page: { id: string; title: string; slug: string; content: string };
}

export default function StorefrontPageView({ orgId, slug }: { orgId: string; slug: string }) {
  const state = useStorefrontContent<PagePayload>(
    `/organizations/${encodeURIComponent(orgId)}/public/pages/${encodeURIComponent(slug)}`
  );

  return (
    <StorefrontShell orgId={orgId} state={state} notFoundTitle="Page not found">
      {({ page }) => (
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <article data-testid="storefront-page">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
              {page.title}
            </h1>
            <ContentHtml html={page.content} className="mt-8" />
          </article>
        </main>
      )}
    </StorefrontShell>
  );
}
