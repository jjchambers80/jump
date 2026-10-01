'use client';

import StorefrontPageBody, { type PublicPage } from './StorefrontPageBody';
import StorefrontShell, { type StorefrontOrganization } from './StorefrontShell';
import { useStorefrontContent } from './useStorefrontContent';

interface PagePayload {
  organization: StorefrontOrganization;
  page: PublicPage;
}

export default function StorefrontPageView({ orgId, slug }: { orgId: string; slug: string }) {
  const state = useStorefrontContent<PagePayload>(
    `/organizations/${encodeURIComponent(orgId)}/public/pages/${encodeURIComponent(slug)}`
  );

  return (
    <StorefrontShell orgId={orgId} state={state} notFoundTitle="Page not found">
      {({ organization, page }) => <StorefrontPageBody page={page} organizationId={organization.id} />}
    </StorefrontShell>
  );
}
