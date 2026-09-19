'use client';

import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import FilePickerDialog from '@/components/content/FilePickerDialog';
import SeoListingCard, {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  previewHandle,
} from '@/components/content/SeoListingCard';
import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { htmlToText } from '@/lib/html';
import type { OnlineStorePage, OnlineStorePageInput } from '@/services/api';

// Limits and the handle preview now live in the shared SEO card (spec 026).
export { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, previewHandle };

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const hint = 'mt-1 text-xs text-gray-500 dark:text-slate-400';

interface PageFormProps {
  /** Existing page when editing; omitted when creating. */
  initial?: OnlineStorePage;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (input: OnlineStorePageInput) => Promise<void>;
}

export default function PageForm({
  initial,
  submitLabel,
  submittingLabel,
  onSubmit,
}: PageFormProps) {
  const { selectedOrgId } = useOrg();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickImage = useRef<((file: { url: string; alt: string } | null) => void) | null>(null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [isVisible, setIsVisible] = useState(initial?.isVisible ?? false);
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? '');
  // The handle is only stored once the organizer types one; blank follows the title.
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !htmlToText(content) || !selectedOrgId) return;

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
            <div className="mt-1">
              <RichTextEditorField
                value={content}
                onChange={setContent}
                aria-label="Page content"
                placeholder="Write the page content…"
                onInsertImage={() =>
                  new Promise((resolve) => {
                    pickImage.current = resolve;
                    setPickerOpen(true);
                  })
                }
              />
            </div>
            <p className={hint}>
              Use the toolbar to format the content shown on your online store.
            </p>
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

        <SeoListingCard
          title={title}
          seoTitle={seoTitle}
          seoDescription={seoDescription}
          handle={slug}
          handlePrefix="pages/"
          urlFor={(handle) => `${origin}/organizations/${selectedOrgId ?? ''}/pages/${handle}`}
          onSeoTitleChange={setSeoTitle}
          onSeoDescriptionChange={setSeoDescription}
          onHandleChange={setSlug}
        />

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
      {pickerOpen && (
        <FilePickerDialog
          title="Insert image"
          onClose={() => {
            pickImage.current?.(null);
            setPickerOpen(false);
          }}
          onPick={(file) => {
            pickImage.current?.({ url: file.url, alt: file.altText ?? file.name });
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}
