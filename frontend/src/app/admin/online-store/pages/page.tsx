'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import api, { type OnlineStorePage } from '@/services/api';

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function PagesPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const [pages, setPages] = useState<OnlineStorePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPages = useCallback(async () => {
    if (!selectedOrgId) {
      setPages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ pages: OnlineStorePage[] }>('/admin/pages');
      setPages(result.pages);
    } catch (err: any) {
      setError(err.message || 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    if (!orgLoading) void loadPages();
  }, [orgLoading, loadPages]);

  const createAction = (
    <Link
      href="/admin/online-store/pages/new"
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
    >
      Create Page
    </Link>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4" data-testid="pages-header">
        <div>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Online store</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pages</h1>
        </div>
        {!loading && pages.length > 0 && createAction}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadPages()}
            className="mt-2 font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div aria-label="Loading pages" className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-14 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700"
            />
          ))}
        </div>
      )}

      {!loading && !error && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      )}

      {!loading && !error && selectedOrgId && pages.length === 0 && (
        <div
          data-testid="pages-empty-state"
          className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center dark:border-slate-600 dark:bg-slate-800"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            No pages have been created
          </h2>
          <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-slate-400">
            Create a page to share information such as policies, contact details, or your
            organization&apos;s story.
          </p>
          <div className="mt-5">{createAction}</div>
        </div>
      )}

      {!loading && !error && pages.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <div className="overflow-x-auto">
            <table
              aria-label="Online store pages"
              className="min-w-full divide-y divide-gray-200 dark:divide-slate-700"
            >
              <thead className="bg-gray-50 dark:bg-slate-900/50">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400"
                  >
                    Title
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400"
                  >
                    Visibility
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400"
                  >
                    Last updated
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {pages.map((storePage) => (
                  <tr key={storePage.id}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      <Link
                        href={`/admin/online-store/pages/${storePage.id}`}
                        className="hover:underline"
                      >
                        {storePage.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${storePage.isVisible ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300'}`}
                      >
                        {storePage.isVisible ? 'Visible' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                      {formatDate(storePage.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      <Link
                        href={`/admin/online-store/pages/${storePage.id}`}
                        aria-label={`Edit ${storePage.title}`}
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
