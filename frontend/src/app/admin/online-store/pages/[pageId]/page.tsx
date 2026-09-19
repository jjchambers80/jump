'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import api, { type OnlineStorePage, type OnlineStorePageInput } from '@/services/api';
import PageForm from '../PageForm';

export default function EditPagePage({ params }: { params: { pageId: string } }) {
  const router = useRouter();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const [page, setPage] = useState<OnlineStorePage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orgLoading || !selectedOrgId) return;
    let cancelled = false;
    api
      .get<OnlineStorePage>(`/admin/pages/${params.pageId}`)
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'Failed to load page');
      });
    return () => {
      cancelled = true;
    };
  }, [orgLoading, selectedOrgId, params.pageId]);

  const save = async (input: OnlineStorePageInput) => {
    await api.put<OnlineStorePage>(`/admin/pages/${params.pageId}`, input);
    router.push('/admin/online-store/pages');
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
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
          {page ? page.title : 'Edit page'}
        </h1>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {!error && !page && (
        <div aria-label="Loading page" className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-14 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          ))}
        </div>
      )}

      {page && (
        <PageForm
          key={page.id}
          initial={page}
          submitLabel="Save"
          submittingLabel="Saving…"
          onSubmit={save}
        />
      )}
    </div>
  );
}
