'use client';

// Shared loader for /new and /[postId]: blogs + tag suggestions, then the form.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import type { Blog, BlogPost } from '@/lib/blog';
import BlogPostForm from './BlogPostForm';
import { useBlogApi } from './useBlogApi';

export default function PostEditorPage({ postId }: { postId: string | null }) {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const blogApi = useBlogApi();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const loadBlogs = useCallback(async () => {
    setBlogs((await blogApi.blogs()).blogs);
  }, [blogApi]);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const [blogList, tagList, record] = await Promise.all([
        blogApi.blogs(),
        blogApi.tags().catch(() => ({ tags: [] })),
        postId ? blogApi.get(postId) : Promise.resolve(null),
      ]);
      setBlogs(blogList.blogs);
      setTags(tagList.tags.map((t) => t.tag));
      setPost(record);
    } catch (err: any) {
      if (err?.status === 404) setNotFound(true);
      else setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, blogApi, postId]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const back = (
    <Link
      href="/admin/content/blog-posts"
      className="text-sm text-gray-600 hover:underline dark:text-slate-300"
    >
      Blog posts
    </Link>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        {back}
        <div aria-label="Loading blog post" className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="h-96 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          <div className="h-72 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (!selectedOrgId || notFound || error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        {back}
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          {!selectedOrgId
            ? 'Pick an organization from the menu in the top right.'
            : notFound
              ? 'This blog post was not found.'
              : error}
        </div>
      </div>
    );
  }

  return (
    <BlogPostForm
      key={post?.id ?? 'new'}
      post={post}
      blogs={blogs}
      tagSuggestions={tags}
      onSaved={(saved) => setPost(saved)}
      onBlogsChanged={loadBlogs}
    />
  );
}
