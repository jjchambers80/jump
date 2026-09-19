// Public blog listing — /organizations/[orgId]/blogs/[blogHandle] (and
// /blogs/[blogHandle] on a tenant host). Server wrapper for metadata; the
// listing itself is the client view (it holds the private-store token).

import type { Metadata } from 'next';
import BlogListingView from '@/components/storefront/BlogListingView';
import { fetchPublicJson } from '@/lib/storefrontMeta';

type Params = { orgId: string; blogHandle: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await fetchPublicJson<{ organization: { name: string }; blog: { title: string } }>(
    `/organizations/${encodeURIComponent(params.orgId)}/public/blogs/${encodeURIComponent(params.blogHandle)}`
  );
  if (!data) return {};
  return { title: `${data.blog.title} · ${data.organization.name}` };
}

export default function BlogListingPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: { page?: string };
}) {
  const page = Math.max(1, Number(searchParams?.page) || 1);
  return <BlogListingView orgId={params.orgId} blogHandle={params.blogHandle} page={page} />;
}
