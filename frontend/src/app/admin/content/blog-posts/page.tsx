'use client';

// Content › Blog posts — /admin/content/blog-posts (spec 026)

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ImageOff, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import StatusPill from '@/components/content/StatusPill';
import ToastHost, { showToast } from '@/components/content/Toast';
import { resolveAssetUrl } from '@/lib/assets';
import {
  blogPostPath,
  formatDate,
  formatDateTime,
  type Blog,
  type BlogPost,
  type BlogPostSort,
  type BlogPostStatus,
} from '@/lib/blog';
import { useBlogApi } from './useBlogApi';

const th =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400';
type Tab = 'all' | BlogPostStatus;
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'visible', label: 'Visible' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'scheduled', label: 'Scheduled' },
];

export default function BlogPostsPage() {
  const router = useRouter();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const blogApi = useBlogApi();

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [summary, setSummary] = useState({ all: 0, visible: 0, hidden: 0, scheduled: 0 });
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [blogId, setBlogId] = useState('');
  const [sort, setSort] = useState<BlogPostSort>('updated_desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<BlogPost[] | null>(null);
  const [busy, setBusy] = useState(false);
  const bulkDeleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [result, blogList] = await Promise.all([
        blogApi.list({ q: debouncedQ, status: tab, blogId: blogId || undefined, sort, page }),
        blogApi.blogs(),
      ]);
      setPosts(result.posts);
      setSummary(result.summary);
      setTotal(result.total);
      setPageSize(result.pageSize);
      setBlogs(blogList.blogs);
      setSelected(new Set());
    } catch (err: any) {
      setError(err?.message || 'Failed to load blog posts');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, blogApi, debouncedQ, tab, blogId, sort, page]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, tab, blogId, sort, selectedOrgId]);

  const allSelected = posts.length > 0 && posts.every((post) => selected.has(post.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(posts.map((post) => post.id)));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: 'show' | 'hide' | 'delete', ids: string[]) => {
    setBusy(true);
    try {
      const result = await blogApi.bulk(ids, action);
      const verb =
        action === 'delete' ? 'deleted' : action === 'show' ? 'set as visible' : 'set as hidden';
      showToast(
        `${result.affected.length} ${result.affected.length === 1 ? 'post' : 'posts'} ${verb}`
      );
      setPendingDelete(null);
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <ToastHost />
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
        data-testid="blog-posts-header"
      >
        <div>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Content</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Blog posts</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/content/blogs"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Manage blogs
          </Link>
          <Link
            href="/admin/content/blog-posts/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Add blog post
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {!orgLoading && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      )}

      {selectedOrgId && (
        <div className="rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3 dark:border-slate-700">
            <div role="tablist" aria-label="Filter by visibility" className="flex gap-1">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    tab === item.key
                      ? 'bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {item.label}
                  <span className="ml-1 text-xs opacity-70">{summary[item.key]}</span>
                </button>
              ))}
            </div>
            <div className="relative min-w-[12rem] flex-1">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search blog posts"
                placeholder="Search title, author or tag"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <label className="sr-only" htmlFor="posts-blog">
              Blog
            </label>
            <select
              id="posts-blog"
              value={blogId}
              onChange={(event) => setBlogId(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">All blogs</option>
              {blogs.map((blog) => (
                <option key={blog.id} value={blog.id}>
                  {blog.title}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="posts-sort">
              Sort
            </label>
            <select
              id="posts-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as BlogPostSort)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="updated_desc">Updated (newest)</option>
              <option value="updated_asc">Updated (oldest)</option>
              <option value="title">Title</option>
              <option value="published_desc">Published</option>
            </select>
          </div>

          {selected.size > 0 && (
            <div
              className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-indigo-50 px-4 py-2 text-sm dark:border-slate-700 dark:bg-indigo-900/20"
              data-testid="bulk-bar"
            >
              <span className="font-medium text-gray-900 dark:text-white">
                {selected.size} selected
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runBulk('show', [...selected])}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                Set as visible
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runBulk('hide', [...selected])}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                Set as hidden
              </button>
              <button
                ref={bulkDeleteRef}
                type="button"
                disabled={busy}
                onClick={() => setPendingDelete(posts.filter((post) => selected.has(post.id)))}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-sm text-gray-600 underline dark:text-slate-300"
              >
                Clear
              </button>
            </div>
          )}

          {loading ? (
            <div aria-label="Loading blog posts" className="space-y-3 p-4">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700"
                />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div
              data-testid="blog-posts-empty-state"
              className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center"
            >
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {debouncedQ || tab !== 'all' || blogId
                  ? 'No blog posts match'
                  : 'No blog posts yet'}
              </h2>
              <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-slate-400">
                {debouncedQ || tab !== 'all' || blogId
                  ? 'Try a different search or filter.'
                  : 'Share news, recaps and announcements with your visitors.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                aria-label="Blog posts"
                className="min-w-full divide-y divide-gray-200 dark:divide-slate-700"
              >
                <thead className="bg-gray-50 dark:bg-slate-900/50">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all blog posts"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </th>
                    <th scope="col" className={th}>
                      Title
                    </th>
                    <th scope="col" className={th}>
                      Visibility
                    </th>
                    <th scope="col" className={th}>
                      Author
                    </th>
                    <th scope="col" className={th}>
                      Blog
                    </th>
                    <th scope="col" className={th}>
                      Updated
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Published
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                  {posts.map((post) => {
                    const href = `/admin/content/blog-posts/${post.id}`;
                    return (
                      <tr
                        key={post.id}
                        data-testid="post-row"
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40"
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('a,button,input')) return;
                          router.push(href);
                        }}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${post.title}`}
                            checked={selected.has(post.id)}
                            onChange={() => toggle(post.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {post.featuredFile?.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={resolveAssetUrl(post.featuredFile.thumbUrl) || undefined}
                                alt=""
                                className="h-10 w-10 flex-shrink-0 rounded border border-gray-200 object-cover dark:border-slate-600"
                              />
                            ) : (
                              <span
                                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-400 dark:border-slate-600 dark:bg-slate-900"
                                aria-hidden
                              >
                                <ImageOff className="h-4 w-4" />
                              </span>
                            )}
                            <Link
                              href={href}
                              className="max-w-md truncate text-sm font-medium text-gray-900 hover:underline dark:text-white"
                            >
                              {post.title}
                            </Link>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={post.status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {post.authorName}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {post.blog.title}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                          {formatDateTime(post.updatedAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500 dark:text-slate-400">
                          {post.status === 'visible' ? (
                            <a
                              href={blogPostPath(
                                post.organizationId,
                                post.blog.handle,
                                post.handle
                              )}
                              target="_blank"
                              rel="noopener"
                              className="hover:underline"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {formatDate(post.publishedAt)}
                            </a>
                          ) : (
                            formatDate(post.publishedAt)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && total > pageSize && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
              <span>
                {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={page >= pageCount}
                  className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          titleId="delete-posts-title"
          title={
            pendingDelete.length === 1
              ? `Delete "${pendingDelete[0].title}"?`
              : `Delete ${pendingDelete.length} blog posts?`
          }
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={busy}
          danger
          returnFocusRef={bulkDeleteRef}
          onClose={() => setPendingDelete(null)}
          onConfirm={() =>
            void runBulk(
              'delete',
              pendingDelete.map((post) => post.id)
            )
          }
        >
          <p>
            Visitors will no longer be able to read{' '}
            {pendingDelete.length === 1 ? 'this post' : 'these posts'}. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
