'use client';

import Link from 'next/link';
import { resolveAssetUrl } from '@/lib/assets';
import { formatPublished, type PublicBlogPostSummary } from './BlogPostCard';
import ContentHtml from './ContentHtml';
import StorefrontShell, { type StorefrontOrganization } from './StorefrontShell';
import { useStorefrontContent } from './useStorefrontContent';

interface PostPayload {
  organization: StorefrontOrganization;
  post: PublicBlogPostSummary & { content: string };
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
      {({ post }) => {
        const image = post.featuredImage;
        return (
          <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
            <article data-testid="blog-post">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                <Link
                  href={`/organizations/${orgId}/blogs/${post.blog.handle}`}
                  className="font-medium text-brand-link hover:underline"
                >
                  {post.blog.title}
                </Link>
                {post.publishedAt ? ` · ${formatPublished(post.publishedAt)}` : ''}
                {post.authorName ? ` · ${post.authorName}` : ''}
              </p>
              <h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
                {post.title}
              </h1>
              {image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveAssetUrl(image.url) || undefined}
                  alt={image.alt}
                  className="mt-6 aspect-[16/9] w-full rounded-xl object-cover"
                  style={{
                    objectPosition: `${(image.focalX ?? 0.5) * 100}% ${(image.focalY ?? 0.5) * 100}%`,
                  }}
                />
              )}
              <ContentHtml html={post.content} className="mt-8" />
              {post.tags.length > 0 && (
                <ul className="mt-8 flex flex-wrap gap-2" aria-label="Tags">
                  {post.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-slate-700 dark:text-slate-200"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </main>
        );
      }}
    </StorefrontShell>
  );
}
