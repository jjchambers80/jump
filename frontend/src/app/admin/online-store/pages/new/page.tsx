'use client';

import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/components/OrgContext';
import api, { type OnlineStorePage } from '@/services/api';

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

export default function CreatePagePage() {
  const router = useRouter();
  const { selectedOrgId } = useOrg();
  const editorRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const format = (command: 'bold' | 'italic' | 'insertUnorderedList') => {
    editorRef.current?.focus();
    document.execCommand(command);
    setContent(editorRef.current?.innerHTML ?? '');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const plainContent = editorRef.current?.textContent?.trim() ?? '';
    if (!title.trim() || !plainContent || !selectedOrgId) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.post<OnlineStorePage>('/admin/pages', {
        title: title.trim(),
        content,
        isVisible,
      });
      router.push('/admin/online-store/pages');
    } catch (err: any) {
      setError(err.message || 'Failed to create page');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/admin/online-store/pages"
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
        >
          ← Pages
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">Create page</h1>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <form
        onSubmit={submit}
        className="space-y-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6"
      >
        <div>
          <label
            htmlFor="page-title"
            className="block text-sm font-medium text-gray-700 dark:text-slate-300"
          >
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
          <span className="block text-sm font-medium text-gray-700 dark:text-slate-300">
            Page content
          </span>
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
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
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

        {!selectedOrgId && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Pick an organization before creating a page.
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
            {submitting ? 'Creating…' : 'Create Page'}
          </button>
        </div>
      </form>
    </div>
  );
}
