// Body of a blog post. Server-safe: the client BlogPostView (legacy) and the
// themed server route render the same markup.

import Link from 'next/link';
import { resolveAssetUrl } from '@/lib/assets';
import { formatPublished, type PublicBlogPostSummary } from './BlogPostCard';
import ContentWithGalleries from './ContentWithGalleries';
import type { PublicGallery } from '@/lib/galleries';

export type PublicBlogPost = PublicBlogPostSummary & {
  content: string;
  /** Spec 046D: galleries the post embeds, resolved for the organization. */
  galleries?: Record<string, PublicGallery>;
};

export default function BlogPostBody({ post, orgId }: { post: PublicBlogPost; orgId: string }) {
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
        <ContentWithGalleries html={post.content} galleries={post.galleries} className="mt-8" />
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
}
