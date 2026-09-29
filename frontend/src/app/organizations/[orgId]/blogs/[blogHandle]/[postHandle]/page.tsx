// Public blog post — /organizations/[orgId]/blogs/[blogHandle]/[postHandle]

import type { Metadata } from 'next';
import BlogPostView from '@/components/storefront/BlogPostView';
import { articleMetadata, fetchPublicJson } from '@/lib/storefrontMeta';
import BlogPostBody, { type PublicBlogPost } from '@/components/storefront/BlogPostBody';
import ThemedContentPage from '@/theme/ThemedContentPage';
import { loadStorefrontFrame } from '@/theme/server/storefront';

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

export default async function BlogPostPage({ params }: { params: Params }) {
  const frame = await loadStorefrontFrame(params.orgId, 'frame');
  if (frame.kind === 'legacy') {
    return <BlogPostView orgId={params.orgId} blogHandle={params.blogHandle} postHandle={params.postHandle} />;
  }
  return (
    <ThemedContentPage<{ post: PublicBlogPost }>
      frame={frame}
      path={`/organizations/${encodeURIComponent(params.orgId)}/public/blogs/${encodeURIComponent(params.blogHandle)}/${encodeURIComponent(params.postHandle)}`}
      notFoundTitle="Post not found"
    >
      {({ post }) => <BlogPostBody post={post} orgId={params.orgId} />}
    </ThemedContentPage>
  );
}
