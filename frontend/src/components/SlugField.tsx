'use client';

// Shared slug input for admin edit forms. Shows the URL preview, auto-suggests
// from the name/title on blur, and lets the user type a custom value.

import { slugify, SLUG_MAX_LENGTH } from '@/lib/slug';

const inputClass =
  'block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

interface SlugFieldProps {
  value: string;
  onChange: (value: string) => void;
  source: string; // title/name to derive a slug from when the field is empty
  prefix?: string; // URL path prefix shown before the slug, e.g. '/events/'
  baseUrl?: string; // full live URL for the preview link
  error?: string | null;
}

export default function SlugField({ value, onChange, source, prefix, baseUrl, error }: SlugFieldProps) {
  const effective = value || slugify(source);
  const url = (baseUrl || '') + (prefix || '') + effective;

  return (
    <div>
      <label htmlFor="slug-input" className={labelClass}>
        URL slug
      </label>
      <div className="mt-1">
        <input
          id="slug-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (!value.trim()) {
              onChange(slugify(source));
            } else {
              onChange(slugify(value));
            }
          }}
          placeholder={slugify(source) || 'custom-url-slug'}
          maxLength={SLUG_MAX_LENGTH}
          className={`${inputClass} ${value ? '' : 'text-gray-500 dark:text-slate-400 italic'}`}
        />
      </div>
      {prefix && effective && (
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          {prefix}{effective}
        </p>
      )}
      {url && (
        <p className="mt-1 text-xs text-gray-400 dark:text-slate-500 break-all">
          Live URL: {url}
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}