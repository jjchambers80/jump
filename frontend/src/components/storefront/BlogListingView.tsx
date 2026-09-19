'use client';

import Link from 'next/link';
import BlogPostCard, { type PublicBlogPostSummary } from './BlogPostCard';
import StorefrontShell, { type StorefrontOrganization } from './StorefrontShell';
import { useStorefrontContent } from './useStorefrontContent';

interface Listing {
  organization: StorefrontOrganization;
  blog: { id: string; title: string; handle: string };
  posts: PublicBlogPostSummary[];
  total: number;
  page: number;
  pageSize: number;
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
      {(data) => {
        const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
        return (
          <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{data.blog.title}</h1>
            {data.posts.length === 0 ? (
              <p className="mt-6 text-sm text-gray-500 dark:text-slate-400">
                No posts yet — check back soon.
              </p>
            ) : (
              <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.posts.map((post) => (
                  <BlogPostCard key={post.id} post={post} href={`${base}/${post.handle}`} />
                ))}
              </div>
            )}
            {pageCount > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-10 flex items-center justify-between text-sm"
              >
                {data.page > 1 ? (
                  <Link
                    href={data.page === 2 ? base : `${base}?page=${data.page - 1}`}
                    className="font-medium text-brand-link hover:underline"
                  >
                    ← Newer posts
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-gray-500 dark:text-slate-400">
                  Page {data.page} of {pageCount}
                </span>
                {data.page < pageCount ? (
                  <Link
                    href={`${base}?page=${data.page + 1}`}
                    className="font-medium text-brand-link hover:underline"
                  >
                    Older posts →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </main>
        );
      }}
    </StorefrontShell>
  );
}
