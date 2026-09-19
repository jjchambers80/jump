'use client';

import Link from 'next/link';
import { resolveAssetUrl } from '@/lib/assets';
import ContentHtml from './ContentHtml';

export interface PublicBlogPostSummary {
  id: string;
  title: string;
  handle: string;
  blog: { id: string; title: string; handle: string };
  authorName: string;
  tags: string[];
  publishedAt: string | null;
  excerpt: string;
  featuredImage: {
    url: string;
    previewUrl: string | null;
    alt: string;
    focalX: number | null;
    focalY: number | null;
  } | null;
}

export function formatPublished(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function BlogPostCard({
  post,
  href,
}: {
  post: PublicBlogPostSummary;
  href: string;
}) {
  const image = post.featuredImage;
  return (
    <article
      data-testid="blog-post-card"
      className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800"
    >
      {image && (
        <Link href={href} tabIndex={-1} aria-hidden className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveAssetUrl(image.previewUrl ?? image.url) || undefined}
            alt=""
            className="aspect-[4/3] w-full object-cover"
            style={{
              objectPosition: `${(image.focalX ?? 0.5) * 100}% ${(image.focalY ?? 0.5) * 100}%`,
            }}
            loading="lazy"
          />
        </Link>
      )}
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
          {formatPublished(post.publishedAt)}
          {post.authorName ? ` · ${post.authorName}` : ''}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
          <Link href={href} className="hover:text-brand-link hover:underline">
            {post.title}
          </Link>
        </h2>
        <ContentHtml html={post.excerpt} className="mt-2 line-clamp-3 text-sm" />
        {post.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
            {post.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-slate-700 dark:text-slate-200"
              >
                {tag}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
