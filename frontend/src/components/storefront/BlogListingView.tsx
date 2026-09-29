'use client';

import BlogListingBody, { type BlogListing } from './BlogListingBody';
import StorefrontShell, { type StorefrontOrganization } from './StorefrontShell';
import { useStorefrontContent } from './useStorefrontContent';

interface Listing extends BlogListing {
  organization: StorefrontOrganization;
}

export default function BlogListingView({
  orgId,
  blogHandle,
  page,
}: {
  orgId: string;
  blogHandle: string;
  page: number;
}) {
  const state = useStorefrontContent<Listing>(
    `/organizations/${encodeURIComponent(orgId)}/public/blogs/${encodeURIComponent(blogHandle)}${page > 1 ? `?page=${page}` : ''}`
  );
  const base = `/organizations/${orgId}/blogs/${blogHandle}`;

  return (
    <StorefrontShell orgId={orgId} state={state} notFoundTitle="Blog not found">
      {(data) => <BlogListingBody data={data} base={base} />}
    </StorefrontShell>
  );
}
