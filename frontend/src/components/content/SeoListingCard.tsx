'use client';

// Shopify-style "Search engine listing" card shared by pages and blog posts:
// Google-style preview, page title, meta description, URL handle.

// Limits mirror backend/src/utils/pageLimits.js.
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

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

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const hint = 'mt-1 text-xs text-gray-500 dark:text-slate-400';

interface SeoListingCardProps {
  /** Record title, used as the fallback listing title and handle source. */
  title: string;
  seoTitle: string;
  seoDescription: string;
  handle: string;
  /** Prefix shown before the handle input, e.g. "pages/" or "blogs/news/". */
  handlePrefix: string;
  /** Full URL preview for the current (or derived) handle. */
  urlFor: (handle: string) => string;
  onSeoTitleChange: (value: string) => void;
  onSeoDescriptionChange: (value: string) => void;
  onHandleChange: (value: string) => void;
  noun?: string;
}

export default function SeoListingCard({
  title,
  seoTitle,
  seoDescription,
  handle,
  handlePrefix,
  urlFor,
  onSeoTitleChange,
  onSeoDescriptionChange,
  onHandleChange,
  noun = 'page',
}: SeoListingCardProps) {
  const effectiveHandle = previewHandle(handle || title);
  const url = urlFor(effectiveHandle);

  return (
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
          Add a title and description to see how this {noun} might appear in a search engine
          listing.
        </p>
      </div>

      <div
        data-testid="seo-preview"
        className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900"
      >
        <p className="truncate text-xs text-gray-600 dark:text-slate-400">{url}</p>
        <p className="mt-1 truncate text-lg text-blue-700 dark:text-blue-400">
          {seoTitle.trim() || title.trim() || 'Page title'}
        </p>
        <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-slate-300">
          {seoDescription.trim() ||
            'Add a meta description to control the snippet shown under the title.'}
        </p>
      </div>

      <div>
        <label htmlFor="seo-title" className={label}>
          Page title
        </label>
        <input
          id="seo-title"
          value={seoTitle}
          onChange={(event) => onSeoTitleChange(event.target.value)}
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
          onChange={(event) => onSeoDescriptionChange(event.target.value)}
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
            {handlePrefix}
          </span>
          <input
            id="seo-handle"
            value={handle}
            onChange={(event) => onHandleChange(event.target.value)}
            onBlur={() => onHandleChange(previewHandle(handle))}
            maxLength={60}
            placeholder={previewHandle(title) || 'about-us'}
            className="block w-full rounded-r-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
        </div>
        <p className={hint} data-testid="seo-url">
          {url}
        </p>
      </div>
    </section>
  );
}
