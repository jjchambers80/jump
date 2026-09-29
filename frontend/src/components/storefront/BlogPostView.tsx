'use client';

import BlogPostBody, { type PublicBlogPost } from './BlogPostBody';
import StorefrontShell, { type StorefrontOrganization } from './StorefrontShell';
import { useStorefrontContent } from './useStorefrontContent';

interface PostPayload {
  organization: StorefrontOrganization;
  post: PublicBlogPost;
}

export default function BlogPostView({
  orgId,
  blogHandle,
  postHandle,
}: {
  orgId: string;
  blogHandle: string;
  postHandle: string;
}) {
  const state = useStorefrontContent<PostPayload>(
    `/organizations/${encodeURIComponent(orgId)}/public/blogs/${encodeURIComponent(blogHandle)}/${encodeURIComponent(postHandle)}`
  );

  return (
    <StorefrontShell orgId={orgId} state={state} notFoundTitle="Post not found">
      {({ post }) => <BlogPostBody post={post} orgId={orgId} />}
    </StorefrontShell>
  );
}
