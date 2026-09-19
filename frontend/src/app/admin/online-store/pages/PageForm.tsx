'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import type { OnlineStorePage, OnlineStorePageInput } from '@/services/api';

// Search engine listing limits, mirrored from backend/src/utils/pageLimits.js.
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const hint = 'mt-1 text-xs text-gray-500 dark:text-slate-400';

/** Client-side preview of the handle the backend derives from a title. */
export function previewHandle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

interface PageFormProps {
  /** Existing page when editing; omitted when creating. */
  initial?: OnlineStorePage;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (input: OnlineStorePageInput) => Promise<void>;
}

export default function PageForm({ initial, submitLabel, submittingLabel, onSubmit }: PageFormProps) {
  const { selectedOrgId } = useOrg();
  const editorRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [isVisible, setIsVisible] = useState(initial?.isVisible ?? false);
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? '');
  // The handle is only stored once the organizer types one; blank follows the title.
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // contentEditable owns its DOM: seed it once from the saved HTML.
  useEffect(() => {
    if (editorRef.current && initial?.content) editorRef.current.innerHTML = initial.content;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const format = (command: 'bold' | 'italic' | 'insertUnorderedList') => {
    editorRef.current?.focus();
    document.execCommand(command);
    setContent(editorRef.current?.innerHTML ?? '');
  };

  const effectiveHandle = previewHandle(slug || title);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const pageUrl = `${origin}/organizations/${selectedOrgId ?? ''}/pages/${effectiveHandle}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const plainContent = editorRef.current?.textContent?.trim() ?? '';
    if (!title.trim() || !plainContent || !selectedOrgId) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        content,
        isVisible,
        slug: slug.trim(),
        seoTitle: seoTitle.trim() || null,
        seoDescription: seoDescription.trim() || null,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to save page');
      setSubmitting(false);
    }
  };

  return (
    <>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
          <div>
            <label htmlFor="page-title" className={label}>
              Title
            </label>
            <input
              id="page-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={200}
              className={field}
            />
          </div>

          <div>
            <span className={label}>Page content</span>
            <div
              role="toolbar"
              aria-label="Text formatting"
              className="mt-1 flex gap-1 rounded-t-md border border-b-0 border-gray-300 bg-gray-50 p-2 dark:border-slate-600 dark:bg-slate-900"
            >
              <button
                type="button"
                onClick={() => format('bold')}
                aria-label="Bold"
                className="rounded px-3 py-1 text-sm font-bold text-gray-700 hover:bg-gray-200 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => format('italic')}
                aria-label="Italic"
                className="rounded px-3 py-1 text-sm italic text-gray-700 hover:bg-gray-200 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                I
              </button>
              <button
                type="button"
                onClick={() => format('insertUnorderedList')}
                aria-label="Bulleted list"
                className="rounded px-3 py-1 text-sm text-gray-700 hover:bg-gray-200 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                List
              </button>
            </div>
            <div
              ref={editorRef}
              role="textbox"
              aria-label="Page content"
              aria-multiline="true"
              contentEditable
              suppressContentEditableWarning
              onInput={(event) => setContent(event.currentTarget.innerHTML)}
              className="min-h-56 rounded-b-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
            <p className={hint}>Use the toolbar to format the content shown on your online store.</p>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-md border border-gray-200 p-4 dark:border-slate-700">
            <span>
              <span className="block text-sm font-medium text-gray-900 dark:text-white">
                Visible on the online store
              </span>
              <span className="block text-xs text-gray-500 dark:text-slate-400">
                Turn this on when the page is ready for visitors.
              </span>
            </span>
            <input
              type="checkbox"
              checked={isVisible}
              onChange={(event) => setIsVisible(event.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
          </label>
        </section>

        <section
          aria-labelledby="seo-heading"
          data-testid="search-engine-listing"
          className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6"
        >
          <div>
            <h2 id="seo-heading" className="text-base font-semibold text-gray-900 dark:text-white">
              Search engine listing
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              Add a title and description to see how this page might appear in a search engine
              listing.
            </p>
          </div>

          {/* Google-style preview of the listing */}
          <div
            data-testid="seo-preview"
            className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <p className="truncate text-xs text-gray-600 dark:text-slate-400">{pageUrl}</p>
            <p className="mt-1 truncate text-lg text-blue-700 dark:text-blue-400">
              {seoTitle.trim() || title.trim() || 'Page title'}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-slate-300">
              {seoDescription.trim() || 'Add a meta description to control the snippet shown under the title.'}
            </p>
          </div>

          <div>
            <label htmlFor="seo-title" className={label}>
              Page title
            </label>
            <input
              id="seo-title"
              value={seoTitle}
              onChange={(event) => setSeoTitle(event.target.value)}
              maxLength={SEO_TITLE_MAX}
              placeholder={title.trim() || undefined}
              className={field}
            />
            <p className={hint}>
              {seoTitle.length} of {SEO_TITLE_MAX} characters used
            </p>
          </div>

          <div>
            <label htmlFor="seo-description" className={label}>
              Meta description
            </label>
            <textarea
              id="seo-description"
              value={seoDescription}
              onChange={(event) => setSeoDescription(event.target.value)}
              maxLength={SEO_DESCRIPTION_MAX}
              rows={3}
              className={field}
            />
            <p className={hint}>
              {seoDescription.length} of {SEO_DESCRIPTION_MAX} characters used
            </p>
          </div>

          <div>
            <label htmlFor="seo-handle" className={label}>
              URL handle
            </label>
            <div className="mt-1 flex rounded-md shadow-sm">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
                pages/
              </span>
              <input
                id="seo-handle"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                onBlur={() => setSlug((current) => previewHandle(current))}
                maxLength={60}
                placeholder={previewHandle(title) || 'about-us'}
                className="block w-full rounded-r-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <p className={hint} data-testid="seo-url">
              {pageUrl}
            </p>
          </div>
        </section>

        {!selectedOrgId && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Pick an organization before saving a page.
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Link
            href="/admin/online-store/pages"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || !selectedOrgId}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </form>
    </>
  );
}
