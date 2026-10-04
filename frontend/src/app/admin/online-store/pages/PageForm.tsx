'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Eye } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import FilePickerDialog from '@/components/content/FilePickerDialog';
import SeoListingCard, {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  previewHandle,
} from '@/components/content/SeoListingCard';
import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { htmlToText } from '@/lib/html';
import api, { type OnlineStorePage, type OnlineStorePageInput, type PageTemplate } from '@/services/api';

// Limits and the handle preview now live in the shared SEO card (spec 026).
export { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, previewHandle };

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const hint = 'mt-1 text-xs text-gray-500 dark:text-slate-400';
const card =
  'rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6';

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
  const [template, setTemplate] = useState<string | null>(initial?.template ?? null);
  // Spec 042: the organization's page templates (uploaded by a developer) and
  // whether a contact form could deliver (store email set).
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  const [storeEmail, setStoreEmail] = useState<string | null | undefined>(undefined);
  const { data: session } = useSession();
  const isSystemAdmin = (session?.user as { role?: string } | undefined)?.role === 'SYSTEM_ADMIN';
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? '');
  // The handle is only stored once the organizer types one; blank follows the title.
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  useEffect(() => {
    if (!selectedOrgId) return;
    let cancelled = false;
    api
      .get<{ templates: PageTemplate[] }>('/admin/page-templates')
      .then((result) => {
        if (!cancelled) setTemplates(result.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    api
      .get<{ email: string | null }>('/admin/settings/business-details')
      .then((result) => {
        if (!cancelled) setStoreEmail(result?.email ?? null);
      })
      .catch(() => {
        if (!cancelled) setStoreEmail(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOrgId]);

  const chosen = templates?.find((item) => item.name === template) ?? null;
  // A saved name with no matching template still shows, so the select never misreports it.
  const missingTemplate = template !== null && !chosen;
  const needsStoreEmail =
    chosen?.sections.some((section) => section.type === 'contact_form') && storeEmail === null;
  const liveUrl = initial
    ? `/organizations/${selectedOrgId ?? ''}/pages/${initial.slug}`
    : null;

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
        template,
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

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className={`space-y-6 ${card}`}>
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
        </div>

        <aside className="space-y-6 lg:row-span-2">
          <section className={card} data-testid="visibility-card">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Visibility</h2>
            <div className="mt-3 space-y-2">
              {[
                { value: true, title: 'Visible', hint: 'Published on your online store' },
                { value: false, title: 'Hidden', hint: 'Only staff can see it' },
              ].map((option) => (
                <label key={String(option.value)} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="visibility"
                    checked={isVisible === option.value}
                    onChange={() => setIsVisible(option.value)}
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
          </section>

          <section className={card} data-testid="template-card">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="page-template"
                className="text-base font-semibold text-gray-900 dark:text-white"
              >
                Template
              </label>
              {liveUrl && initial?.isVisible && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                  aria-label="View page on the online store"
                  title="View page"
                >
                  <Eye className="h-4 w-4" aria-hidden />
                </a>
              )}
            </div>
            <select
              id="page-template"
              value={template ?? ''}
              onChange={(event) => setTemplate(event.target.value || null)}
              className={field}
            >
              <option value="">Default page</option>
              {(templates ?? []).map((item) => (
                <option key={item.id} value={item.name}>
                  {item.label}
                </option>
              ))}
              {missingTemplate && <option value={template ?? ''}>{template} (missing)</option>}
            </select>
            <p className={hint}>
              {chosen?.description ||
                (templates?.length
                  ? 'Choose how this page is laid out on your online store.'
                  : 'No custom templates yet. Pages use the default layout.')}
            </p>
            {needsStoreEmail && (
              <p
                role="status"
                className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
              >
                This template has a contact form. Add a store email in{' '}
                <Link href="/admin/settings" className="font-semibold underline">
                  Settings
                </Link>{' '}
                so messages can be delivered.
              </p>
            )}
            {isSystemAdmin && (
              <Link
                href="/admin/online-store/page-templates"
                className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
              >
                Manage templates
              </Link>
            )}
          </section>
        </aside>

        <div className="space-y-3 lg:col-start-1">
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
