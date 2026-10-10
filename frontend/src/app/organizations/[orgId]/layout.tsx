// Every storefront page of an organization (and its custom domain) gets the
// org favicon (spec 049): square logo (Settings › Brand) ?? platform default.

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { faviconMetadata, fetchPublicJson } from '@/lib/storefrontMeta';

export async function generateMetadata({ params }: { params: { orgId: string } }): Promise<Metadata> {
  const meta = await fetchPublicJson<{ faviconUrl?: string | null }>(
    `/organizations/${encodeURIComponent(params.orgId)}/public/meta`,
  );
  return faviconMetadata(meta?.faviconUrl);
}

export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return children;
}
