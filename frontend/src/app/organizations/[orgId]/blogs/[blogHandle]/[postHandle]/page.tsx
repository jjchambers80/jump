// Public blog post — /organizations/[orgId]/blogs/[blogHandle]/[postHandle]

import type { Metadata } from 'next';
import BlogPostView from '@/components/storefront/BlogPostView';
import { articleMetadata, fetchPublicJson } from '@/lib/storefrontMeta';

type Params = { orgId: string; blogHandle: string; postHandle: string };

interface PostMeta {
  organization: { name: string };
  post: {
    seoTitle: string;
    seoDescription: string | null;
    publishedAt: string | null;
    featuredImage: { previewUrl: string | null; url: string } | null;
  };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await fetchPublicJson<PostMeta>(
    `/organizations/${encodeURIComponent(params.orgId)}/public/blogs/${encodeURIComponent(params.blogHandle)}/${encodeURIComponent(params.postHandle)}`
  );
  if (!data) return {};
  return articleMetadata({
    title: data.post.seoTitle,
    description: data.post.seoDescription,
    siteName: data.organization.name,
    imageUrl: data.post.featuredImage?.previewUrl ?? data.post.featuredImage?.url ?? null,
    publishedAt: data.post.publishedAt,
  });
}

export default function BlogPostPage({ params }: { params: Params }) {
  return (
    <BlogPostView
      orgId={params.orgId}
      blogHandle={params.blogHandle}
      postHandle={params.postHandle}
    />
  );
}
