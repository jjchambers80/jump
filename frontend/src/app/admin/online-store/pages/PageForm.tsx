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
import api, { type OnlineStorePage, type OnlineStorePageInput, type PageTemplate, type ApplicationFormSummary } from '@/services/api';
import { FULL_WIDTH_TEMPLATE } from '@jump/theme';
import { editorHref, themesApi } from '@/lib/themes';

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
  // Full width (built in): the page's body is laid out in the theme editor, so
  // it is offered only when the store renders through themes. Value: the live theme's id.
  const [mainThemeId, setMainThemeId] = useState<string | null>(null);
  // Spec 044D: standing application forms for the Apply button
  const [standingForms, setStandingForms] = useState<ApplicationFormSummary[] | null>(null);
  const { data: session } = useSession();
  const isSystemAdmin = (session?.user as { role?: string } | undefined)?.role === 'SYSTEM_ADMIN';
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? '');
  // The handle is only stored once the organizer types one; blank follows the title.
  const [slug, setSlug] = useState(initial?.slug ?? '');
  // Spec 044D: Apply button settings
  const [applicationFormId, setApplicationFormId] = useState<string | null>(initial?.applicationFormId ?? null);
  const [applyLabel, setApplyLabel] = useState<string | null>(initial?.applyLabel ?? null);
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
    themesApi
      .status()
      .then(async (status) => {
        if (!status.enabled) return;
        const { themes } = await themesApi.list();
        if (!cancelled) setMainThemeId(themes.find((t) => t.role === 'MAIN')?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setMainThemeId(null);
      });
    // Spec 044D: fetch standing application forms for this org
    api
      .get<{ data: ApplicationFormSummary[] }>(`/admin/standing-application-forms`)
      .then((result) => {
        if (!cancelled) setStandingForms(result.data);
      })
      .catch(() => {
        if (!cancelled) setStandingForms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOrgId]);

  const chosen = templates?.find((item) => item.name === template) ?? null;
  const fullWidth = template === FULL_WIDTH_TEMPLATE;
  // A saved name with no matching template still shows, so the select never misreports it.
  const missingTemplate = template !== null && !chosen && !fullWidth;
  const needsStoreEmail =
    chosen?.sections.some((section) => section.type === 'contact_form') && storeEmail === null;
  const liveUrl = initial
    ? `/organizations/${selectedOrgId ?? ''}/pages/${initial.slug}`
    : null;
  const chosenForm = standingForms?.find((f) => f.id === applicationFormId) ?? null;

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
        applicationFormId,
        applyLabel: applyLabel?.trim() || null,
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
              {(mainThemeId || fullWidth) && <option value={FULL_WIDTH_TEMPLATE}>Full width</option>}
              {(templates ?? []).map((item) => (
                <option key={item.id} value={item.name}>
                  {item.label}
                </option>
              ))}
              {missingTemplate && <option value={template ?? ''}>{template} (missing)</option>}
            </select>
            <p className={hint}>
              {(fullWidth &&
                (mainThemeId
                  ? 'Edge-to-edge sections around your page content, laid out in the theme editor.'
                  : 'Needs the theme editor, which is off for this store. The page shows its default layout.')) ||
                chosen?.description ||
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
            {fullWidth && mainThemeId && (
              initial?.template === FULL_WIDTH_TEMPLATE ? (
                <Link
                  href={`${editorHref(mainThemeId)}?page=${encodeURIComponent(`page:${initial.id}`)}`}
                  data-testid="customize-page"
                  className="mt-3 inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  Customize
                </Link>
              ) : (
                <p className={hint}>Save the page, then customize its layout.</p>
              )
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

          {/* Spec 044D: a standing form opened from a button on this page */}
          <section className={card} data-testid="apply-button-card">
            <label htmlFor="page-apply-form" className="text-base font-semibold text-gray-900 dark:text-white">
              Apply button
            </label>
            <p className={hint}>Opens one of your standing forms (Content › Forms) in a panel over the page.</p>
            <select
              id="page-apply-form"
              value={applicationFormId ?? ''}
              onChange={(event) => setApplicationFormId(event.target.value || null)}
              className={`${field} mt-3`}
            >
              <option value="">No button</option>
              {(standingForms ?? []).map((form) => (
                <option key={form.id} value={form.id}>
                  {form.status === 'OPEN' ? form.name : `${form.name} (${form.status.toLowerCase()})`}
                </option>
              ))}
            </select>
            {chosenForm && chosenForm.status !== 'OPEN' && (
              <p className={hint}>
                {chosenForm.status === 'DRAFT'
                  ? 'Visitors see the button once you open the form.'
                  : 'Visitors see that applications are closed.'}
              </p>
            )}
            {applicationFormId && (
              <div className="mt-3">
                <label htmlFor="page-apply-label" className={label}>
                  Button label
                </label>
                <input
                  id="page-apply-label"
                  type="text"
                  maxLength={40}
                  value={applyLabel ?? ''}
                  onChange={(event) => setApplyLabel(event.target.value)}
                  placeholder={chosenForm?.buttonLabel || 'Apply now'}
                  className={field}
                />
              </div>
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
