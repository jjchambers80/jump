'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api, { type OnlineStorePage, type OnlineStorePageInput } from '@/services/api';
import PageForm from '../PageForm';

export default function CreatePagePage() {
  const router = useRouter();

  const create = async (input: OnlineStorePageInput) => {
    await api.post<OnlineStorePage>('/admin/pages', input);
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
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">Create page</h1>
      </div>

      <PageForm submitLabel="Create Page" submittingLabel="Creating…" onSubmit={create} />
    </div>
  );
}
