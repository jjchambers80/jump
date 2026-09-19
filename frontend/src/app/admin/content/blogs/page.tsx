'use client';

// Content › Blog posts › Manage blogs — /admin/content/blogs (spec 026)
// Blogs are the containers (the organizer's categories): add, rename, delete
// (moving posts first when the blog still has any).

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import ToastHost, { showToast } from '@/components/content/Toast';
import { previewHandle } from '@/components/content/SeoListingCard';
import type { Blog } from '@/lib/blog';
import { useBlogApi } from '../blog-posts/useBlogApi';

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const th =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400';

type Mode = { kind: 'create' } | { kind: 'edit'; blog: Blog } | { kind: 'delete'; blog: Blog };

export default function BlogsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const blogApi = useBlogApi();
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const titleRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setBlogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBlogs((await blogApi.blogs()).blogs);
    } catch (err: any) {
      setError(err?.message || 'Failed to load blogs');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, blogApi]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const open = (next: Mode) => {
    setDialogError(null);
    setTitle(next.kind === 'edit' ? next.blog.title : '');
    setHandle(next.kind === 'edit' ? next.blog.handle : '');
    setMoveTo(next.kind === 'delete' ? (blogs.find((b) => b.id !== next.blog.id)?.id ?? '') : '');
    setMode(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mode || saving) return;
    setSaving(true);
    setDialogError(null);
    try {
      if (mode.kind === 'create') {
        await blogApi.createBlog({ title: title.trim(), handle: handle.trim() || undefined });
        showToast('Blog created');
      } else if (mode.kind === 'edit') {
        await blogApi.updateBlog(mode.blog.id, { title: title.trim(), handle: handle.trim() });
        showToast('Blog updated');
      } else {
        await blogApi.deleteBlog(mode.blog.id, mode.blog.postCount ? moveTo : undefined);
        showToast('Blog deleted');
      }
      setMode(null);
      await load();
    } catch (err: any) {
      setDialogError(err?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const returnRef =
    mode && mode.kind !== 'create'
      ? { current: rowRefs.current.get(mode.blog.id) ?? null }
      : addRef;
  const dirty =
    mode?.kind === 'create'
      ? title.trim().length > 0
      : mode?.kind === 'edit'
        ? title.trim() !== mode.blog.title || handle.trim() !== mode.blog.handle
        : true;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <ToastHost />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/content/blog-posts"
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Blog posts
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Blogs</h1>
        </div>
        <button
          ref={addRef}
          type="button"
          onClick={() => open({ kind: 'create' })}
          disabled={!selectedOrgId}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          Add blog
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {loading ? (
          <div aria-label="Loading blogs" className="space-y-3 p-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700"
              />
            ))}
          </div>
        ) : (
          <table
            aria-label="Blogs"
            className="min-w-full divide-y divide-gray-200 dark:divide-slate-700"
          >
            <thead className="bg-gray-50 dark:bg-slate-900/50">
              <tr>
                <th scope="col" className={th}>
                  Title
                </th>
                <th scope="col" className={th}>
                  Handle
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Posts
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {blogs.map((blog) => (
                <tr key={blog.id} data-testid="blog-row">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    {blog.title}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                    blogs/{blog.handle}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-slate-400">
                    {blog.postCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <button
                      ref={(el) => {
                        if (el) rowRefs.current.set(blog.id, el);
                      }}
                      type="button"
                      onClick={() => open({ kind: 'edit', blog })}
                      className="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => open({ kind: 'delete', blog })}
                      disabled={blogs.length <= 1}
                      className="ml-3 font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mode && (
        <SettingsDialog
          titleId="blog-dialog-title"
          title={
            mode.kind === 'create'
              ? 'Add blog'
              : mode.kind === 'edit'
                ? 'Edit blog'
                : `Delete ${mode.blog.title}?`
          }
          dirty={dirty}
          saving={saving}
          saveDisabled={mode.kind !== 'delete' ? !title.trim() : !!mode.blog.postCount && !moveTo}
          submitWhenClean={mode.kind === 'delete'}
          submitLabel={mode.kind === 'delete' ? 'Delete' : 'Save'}
          savingLabel={mode.kind === 'delete' ? 'Deleting…' : 'Saving…'}
          initialFocusRef={mode.kind === 'delete' ? undefined : titleRef}
          returnFocusRef={returnRef}
          onClose={() => setMode(null)}
          onSubmit={submit}
        >
          {mode.kind === 'delete' ? (
            <div className="space-y-3 text-sm text-gray-700 dark:text-slate-300">
              {mode.blog.postCount ? (
                <>
                  <p>
                    This blog has {mode.blog.postCount}{' '}
                    {mode.blog.postCount === 1 ? 'post' : 'posts'}. Move them to another blog first.
                  </p>
                  <label htmlFor="move-to" className={label}>
                    Move posts to
                  </label>
                  <select
                    id="move-to"
                    value={moveTo}
                    onChange={(event) => setMoveTo(event.target.value)}
                    className={field}
                  >
                    {blogs
                      .filter((b) => b.id !== mode.blog.id)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                        </option>
                      ))}
                  </select>
                </>
              ) : (
                <p>The blog and its listing page are removed. This cannot be undone.</p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="blog-title" className={label}>
                  Title
                </label>
                <input
                  ref={titleRef}
                  id="blog-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={100}
                  required
                  className={field}
                />
              </div>
              <div>
                <label htmlFor="blog-handle" className={label}>
                  Handle
                </label>
                <div className="mt-1 flex rounded-md shadow-sm">
                  <span className="inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
                    blogs/
                  </span>
                  <input
                    id="blog-handle"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    onBlur={() => setHandle((current) => previewHandle(current))}
                    placeholder={previewHandle(title) || 'news'}
                    maxLength={60}
                    className="block w-full rounded-r-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}
          {dialogError && (
            <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
              {dialogError}
            </p>
          )}
        </SettingsDialog>
      )}
    </div>
  );
}
