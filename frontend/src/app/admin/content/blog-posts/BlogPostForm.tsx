'use client';

// Blog post editor (create + edit). Nothing persists until Save; the sticky
// save bar appears when the form differs from the saved record.

import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useOrg } from '@/components/OrgContext';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import FilePickerDialog from '@/components/content/FilePickerDialog';
import SaveBar from '@/components/content/SaveBar';
import SeoListingCard, { previewHandle } from '@/components/content/SeoListingCard';
import StatusPill from '@/components/content/StatusPill';
import TagInput from '@/components/content/TagInput';
import ToastHost, { showToast } from '@/components/content/Toast';
import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { resolveAssetUrl } from '@/lib/assets';
import {
  blogPostPath,
  fromLocalInput,
  toLocalInput,
  type Blog,
  type BlogPost,
  type BlogPostInput,
} from '@/lib/blog';
import type { StoreFile } from '@/lib/content';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { useBlogApi } from './useBlogApi';

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const card =
  'rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800';
const secondaryButton =
  'inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

interface Draft {
  title: string;
  blogId: string;
  content: string;
  excerpt: string;
  hasExcerpt: boolean;
  authorName: string;
  tags: string[];
  featuredFile: StoreFile | null;
  isVisible: boolean;
  publishedAtLocal: string;
  handle: string;
  seoTitle: string;
  seoDescription: string;
}

function draftFrom(post: BlogPost | null, defaults: { authorName: string; blogId: string }): Draft {
  return {
    title: post?.title ?? '',
    blogId: post?.blogId ?? defaults.blogId,
    content: post?.content ?? '',
    excerpt: post?.excerpt ?? '',
    hasExcerpt: !!post?.excerpt,
    authorName: post?.authorName ?? defaults.authorName,
    tags: post?.tags ?? [],
    featuredFile: post?.featuredFile ?? null,
    isVisible: post?.isVisible ?? false,
    publishedAtLocal: toLocalInput(post?.publishedAt ?? null),
    handle: post?.handle ?? '',
    seoTitle: post?.seoTitle ?? '',
    seoDescription: post?.seoDescription ?? '',
  };
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.title === b.title &&
    a.blogId === b.blogId &&
    a.content === b.content &&
    (a.hasExcerpt ? a.excerpt : '') === (b.hasExcerpt ? b.excerpt : '') &&
    a.authorName === b.authorName &&
    JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
    (a.featuredFile?.id ?? null) === (b.featuredFile?.id ?? null) &&
    a.isVisible === b.isVisible &&
    a.publishedAtLocal === b.publishedAtLocal &&
    a.handle === b.handle &&
    a.seoTitle === b.seoTitle &&
    a.seoDescription === b.seoDescription
  );
}

interface BlogPostFormProps {
  /** Saved record when editing; null when creating. */
  post: BlogPost | null;
  blogs: Blog[];
  tagSuggestions: string[];
  onSaved: (post: BlogPost) => void;
  onBlogsChanged: () => Promise<void>;
}

export default function BlogPostForm({
  post,
  blogs,
  tagSuggestions,
  onSaved,
  onBlogsChanged,
}: BlogPostFormProps) {
  const router = useRouter();
  const { selectedOrgId } = useOrg();
  const { data: session } = useSession();
  const blogApi = useBlogApi();

  const defaults = useMemo(
    () => ({ authorName: session?.user?.name ?? '', blogId: blogs[0]?.id ?? '' }),
    [session?.user?.name, blogs]
  );
  const [saved, setSaved] = useState<Draft>(() => draftFrom(post, defaults));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(post, defaults));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<'featured' | 'editor' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newBlogTitle, setNewBlogTitle] = useState<string | null>(null);
  const editorPick = useRef<((file: { url: string; alt: string } | null) => void) | null>(null);
  const featuredRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  // A freshly saved/loaded record resets both copies; for a new post the
  // session name / first blog fill in only while those fields are empty
  // (creating a blog inline must not wipe the draft).
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  useEffect(() => {
    if (!post) return;
    const next = draftFrom(post, defaultsRef.current);
    setSaved(next);
    setDraft(next);
  }, [post]);
  useEffect(() => {
    if (post) return;
    const fill = (current: Draft) => ({
      ...current,
      authorName: current.authorName || defaults.authorName,
      blogId: current.blogId || defaults.blogId,
    });
    setSaved(fill);
    setDraft(fill);
  }, [post, defaults]);

  const dirty = !sameDraft(draft, saved);
  const valid = draft.title.trim().length > 0 && !!draft.blogId;
  const confirmLeave = useUnsavedChanges(dirty);
  const patch = useCallback(
    (partial: Partial<Draft>) => setDraft((current) => ({ ...current, ...partial })),
    []
  );

  const status = draft.isVisible
    ? draft.publishedAtLocal && new Date(draft.publishedAtLocal) > new Date()
      ? 'scheduled'
      : 'visible'
    : 'hidden';
  const blog = blogs.find((b) => b.id === draft.blogId);
  const publicPath =
    post && selectedOrgId ? blogPostPath(selectedOrgId, post.blog.handle, post.handle) : null;
  const canView = !!post && post.status === 'visible' && !!publicPath;

  const body = (): Partial<BlogPostInput> => {
    const out: Partial<BlogPostInput> = {};
    if (!post || draft.title !== saved.title) out.title = draft.title.trim();
    if (!post || draft.blogId !== saved.blogId) out.blogId = draft.blogId;
    if (!post || draft.content !== saved.content) out.content = draft.content;
    const excerpt = draft.hasExcerpt ? draft.excerpt : '';
    if (!post || excerpt !== (saved.hasExcerpt ? saved.excerpt : '')) out.excerpt = excerpt || null;
    if (!post || draft.authorName !== saved.authorName) out.authorName = draft.authorName.trim();
    if (!post || JSON.stringify(draft.tags) !== JSON.stringify(saved.tags)) out.tags = draft.tags;
    if (!post || (draft.featuredFile?.id ?? null) !== (saved.featuredFile?.id ?? null)) {
      out.featuredFileId = draft.featuredFile?.id ?? null;
    }
    if (!post || draft.isVisible !== saved.isVisible) out.isVisible = draft.isVisible;
    if (!post || draft.publishedAtLocal !== saved.publishedAtLocal)
      out.publishedAt = fromLocalInput(draft.publishedAtLocal);
    if (draft.handle !== saved.handle) out.handle = draft.handle.trim();
    if (!post || draft.seoTitle !== saved.seoTitle) out.seoTitle = draft.seoTitle.trim() || null;
    if (!post || draft.seoDescription !== saved.seoDescription)
      out.seoDescription = draft.seoDescription.trim() || null;
    return out;
  };

  const save = async () => {
    if (!dirty || !valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = post
        ? await blogApi.update(post.id, body())
        : await blogApi.create({ ...body(), title: draft.title.trim() });
      showToast('Saved');
      onSaved(result);
      if (!post) router.replace(`/admin/content/blog-posts/${result.id}`);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!post) return;
    setDeleting(true);
    try {
      await blogApi.remove(post.id);
      router.push('/admin/content/blog-posts');
    } catch (err: any) {
      setDeleting(false);
      setConfirmDelete(false);
      showToast(err?.message || 'Delete failed');
    }
  };

  const createBlog = async () => {
    if (!newBlogTitle?.trim()) return;
    try {
      const created = await blogApi.createBlog({ title: newBlogTitle.trim() });
      await onBlogsChanged();
      patch({ blogId: created.id });
      setNewBlogTitle(null);
      showToast('Blog created');
    } catch (err: any) {
      showToast(err?.message || 'Could not create the blog');
    }
  };

  const navigate = (href: string) => {
    if (confirmLeave()) router.push(href);
  };

  const insertImage = () =>
    new Promise<{ url: string; alt: string } | null>((resolve) => {
      editorPick.current = resolve;
      setPickerFor('editor');
    });

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pb-28">
      <ToastHost />
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
        data-testid="post-header"
      >
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate('/admin/content/blog-posts')}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Blog posts
          </button>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="truncate text-2xl font-bold text-gray-900 dark:text-white">
              {post ? post.title : 'Add blog post'}
            </h1>
            {post && <StatusPill status={post.status} />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {post && (
            <div
              className="flex items-center rounded-md border border-gray-300 dark:border-slate-600"
              role="group"
              aria-label="Previous and next post"
            >
              <button
                type="button"
                aria-label={
                  post.neighbors?.prev
                    ? `Previous: ${post.neighbors.prev.title}`
                    : 'No previous post'
                }
                title={post.neighbors?.prev?.title}
                disabled={!post.neighbors?.prev}
                onClick={() =>
                  post.neighbors?.prev &&
                  navigate(`/admin/content/blog-posts/${post.neighbors.prev.id}`)
                }
                className="inline-flex h-9 w-9 items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={
                  post.neighbors?.next ? `Next: ${post.neighbors.next.title}` : 'No next post'
                }
                title={post.neighbors?.next?.title}
                disabled={!post.neighbors?.next}
                onClick={() =>
                  post.neighbors?.next &&
                  navigate(`/admin/content/blog-posts/${post.neighbors.next.id}`)
                }
                className="inline-flex h-9 w-9 items-center justify-center border-l border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
          {post &&
            (canView ? (
              <a href={publicPath!} target="_blank" rel="noopener" className={secondaryButton}>
                <ExternalLink className="h-4 w-4" aria-hidden />
                View
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Post is not visible"
                className={secondaryButton}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                View
              </button>
            ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className={`${card} space-y-5`}>
            <div>
              <label htmlFor="post-title" className={label}>
                Title
              </label>
              <input
                id="post-title"
                value={draft.title}
                onChange={(event) => patch({ title: event.target.value })}
                maxLength={255}
                required
                placeholder="e.g. Vendor applications open"
                className={field}
              />
            </div>
            <div>
              <span id="post-content-label" className={label}>
                Content
              </span>
              <div className="mt-1">
                <RichTextEditorField
                  value={draft.content}
                  onChange={(html) => patch({ content: html })}
                  placeholder="Write your post…"
                  onInsertImage={insertImage}
                  aria-labelledby="post-content-label"
                  testId="post-content-editor"
                />
              </div>
            </div>
            <div>
              {draft.hasExcerpt ? (
                <>
                  <div className="flex items-center justify-between">
                    <span id="post-excerpt-label" className={label}>
                      Excerpt
                    </span>
                    <button
                      type="button"
                      onClick={() => patch({ hasExcerpt: false, excerpt: '' })}
                      className="text-xs font-medium text-gray-600 hover:underline dark:text-slate-300"
                    >
                      Remove excerpt
                    </button>
                  </div>
                  <div className="mt-1">
                    <RichTextEditorField
                      variant="compact"
                      value={draft.excerpt}
                      onChange={(html) => patch({ excerpt: html })}
                      placeholder="A short summary shown on the blog listing"
                      aria-labelledby="post-excerpt-label"
                      testId="post-excerpt-editor"
                    />
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => patch({ hasExcerpt: true })}
                  className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  Add excerpt
                </button>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Without an excerpt the listing shows the first words of the post.
              </p>
            </div>
          </section>

          <SeoListingCard
            noun="blog post"
            title={draft.title}
            seoTitle={draft.seoTitle}
            seoDescription={draft.seoDescription}
            handle={draft.handle}
            handlePrefix={`blogs/${blog?.handle ?? 'news'}/`}
            urlFor={(handle) =>
              `${origin}${blogPostPath(selectedOrgId ?? '', blog?.handle ?? 'news', handle || previewHandle(draft.title))}`
            }
            onSeoTitleChange={(value) => patch({ seoTitle: value })}
            onSeoDescriptionChange={(value) => patch({ seoDescription: value })}
            onHandleChange={(value) => patch({ handle: value })}
          />

          {post && (
            <div className="flex justify-start">
              <button
                ref={deleteRef}
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-800 dark:bg-slate-800 dark:text-red-300"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete blog post
              </button>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <section className={card} data-testid="visibility-card">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Visibility</h2>
            <div className="mt-3 space-y-2">
              {[
                { value: true, title: 'Visible', hint: 'Published on your online store' },
                { value: false, title: 'Hidden', hint: 'Only staff can see it' },
              ].map((option) => (
                <label
                  key={String(option.value)}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="visibility"
                    checked={draft.isVisible === option.value}
                    onChange={() => patch({ isVisible: option.value })}
                    className="mt-0.5 h-4 w-4 border-gray-300 text-indigo-600"
                  />
                  <span>
                    <span className="block font-medium text-gray-900 dark:text-white">
                      {option.title}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-slate-400">
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4">
              <label htmlFor="post-published-at" className={label}>
                Publish date
              </label>
              <input
                id="post-published-at"
                type="datetime-local"
                value={draft.publishedAtLocal}
                onChange={(event) => patch({ publishedAtLocal: event.target.value })}
                className={field}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                {status === 'scheduled'
                  ? 'A future date keeps the post scheduled until then.'
                  : 'Leave empty to publish as soon as it is visible.'}
              </p>
            </div>
          </section>

          <section className={card} data-testid="featured-image-card">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Featured image
            </h2>
            {draft.featuredFile ? (
              <div className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    resolveAssetUrl(draft.featuredFile.previewUrl ?? draft.featuredFile.url) ||
                    undefined
                  }
                  alt={draft.featuredFile.altText ?? draft.featuredFile.name}
                  className="aspect-[4/3] w-full rounded-md border border-gray-200 object-cover dark:border-slate-600"
                />
                <div className="mt-2 flex gap-3 text-sm">
                  <button
                    ref={featuredRef}
                    type="button"
                    onClick={() => setPickerFor('featured')}
                    className="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ featuredFile: null })}
                    className="font-medium text-gray-600 hover:underline dark:text-slate-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={featuredRef}
                type="button"
                onClick={() => setPickerFor('featured')}
                className="mt-3 flex w-full items-center justify-center rounded-md border-2 border-dashed border-gray-300 px-4 py-8 text-sm font-medium text-indigo-600 hover:border-indigo-400 dark:border-slate-600 dark:text-indigo-300"
              >
                Choose image
              </button>
            )}
          </section>

          <section className={`${card} space-y-4`} data-testid="organization-card">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Organization</h2>
            <div>
              <label htmlFor="post-author" className={label}>
                Author
              </label>
              <input
                id="post-author"
                value={draft.authorName}
                onChange={(event) => patch({ authorName: event.target.value })}
                maxLength={100}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="post-blog" className={label}>
                Blog
              </label>
              <select
                id="post-blog"
                value={draft.blogId}
                onChange={(event) => patch({ blogId: event.target.value })}
                className={field}
              >
                {blogs.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
              {newBlogTitle === null ? (
                <button
                  type="button"
                  onClick={() => setNewBlogTitle('')}
                  className="mt-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  Create a new blog
                </button>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input
                    aria-label="New blog title"
                    value={newBlogTitle}
                    onChange={(event) => setNewBlogTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void createBlog();
                      }
                    }}
                    placeholder="Blog title"
                    className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => void createBlog()}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewBlogTitle(null)}
                    className="text-xs text-gray-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="post-tags" className={label}>
                Tags
              </label>
              <TagInput
                id="post-tags"
                value={draft.tags}
                onChange={(tags) => patch({ tags })}
                suggestions={tagSuggestions}
              />
            </div>
          </section>
        </aside>
      </div>

      <SaveBar
        visible={dirty}
        saving={saving}
        disabled={!valid}
        error={saveError}
        onDiscard={() => setDraft(saved)}
        onSave={() => void save()}
      />

      {pickerFor && (
        <FilePickerDialog
          title={pickerFor === 'featured' ? 'Choose a featured image' : 'Insert image'}
          returnFocusRef={pickerFor === 'featured' ? featuredRef : undefined}
          onClose={() => {
            if (pickerFor === 'editor') editorPick.current?.(null);
            setPickerFor(null);
          }}
          onPick={(file) => {
            if (pickerFor === 'featured') patch({ featuredFile: file });
            else editorPick.current?.({ url: file.url, alt: file.altText ?? file.name });
            setPickerFor(null);
          }}
        />
      )}

      {confirmDelete && post && (
        <ConfirmDialog
          titleId="delete-post-title"
          title={`Delete "${post.title}"?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          returnFocusRef={deleteRef}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        >
          <p>Visitors will no longer be able to read this post. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
