'use client';

// Content › Forms (spec 044): the organization's standing application forms —
// always-on forms with no event (become a vendor, press, volunteers). Each row
// opens the form's Submissions / Fields / Settings. Submitters land in
// Customers like every other contact; there is no second contact list here.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ClipboardList, Plus, Search } from 'lucide-react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { formatDate, type AdminForm } from '@/lib/applications';
import { FORM_STATUS_LABEL, FormStatusBadge } from './FormStatusBadge';

type StatusFilter = 'ALL' | AdminForm['status'];
const FILTERS: StatusFilter[] = ['ALL', 'OPEN', 'DRAFT', 'CLOSED'];

export default function FormsPage() {
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const [forms, setForms] = useState<AdminForm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!selectedOrgId) return;
    setError(null);
    try {
      setForms((await api.get<{ data: AdminForm[] }>('/admin/standing-application-forms')).data);
    } catch (err) {
      setError((err as Error)?.message || 'Could not load forms');
    }
  }, [selectedOrgId]);

  useEffect(() => {
    if (!orgLoading) load();
  }, [orgLoading, load]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { ALL: forms?.length ?? 0, OPEN: 0, DRAFT: 0, CLOSED: 0 };
    for (const f of forms ?? []) c[f.status] += 1;
    return c;
  }, [forms]);
  const term = q.trim().toLowerCase();
  const shown = (forms ?? []).filter((f) => (filter === 'ALL' || f.status === filter) && (!term || f.name.toLowerCase().includes(term) || f.slug.includes(term)));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-accent-600 dark:text-accent-300">Content</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Forms</h1>
          <p className="mt-1 max-w-xl text-sm text-gray-600 dark:text-slate-400">
            Always-on application forms that don&apos;t belong to an event. Everyone who submits one shows up in Customers.
          </p>
        </div>
        {canEdit && (
          <Link
            href="/admin/content/forms/new"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New form
          </Link>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}{' '}
          <button type="button" onClick={load} className="font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {!orgLoading && !selectedOrgId && <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">Pick an organization from the menu in the top right.</p>}

      {selectedOrgId && (
        <section aria-label="Forms" className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-3 dark:border-slate-700 sm:flex-row sm:items-center">
            <div role="group" aria-label="Filter by status" className="flex gap-1 overflow-x-auto">
              {FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={`min-h-[36px] whitespace-nowrap rounded-md px-3 text-sm font-medium ${
                    filter === key ? 'bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {key === 'ALL' ? 'All' : FORM_STATUS_LABEL[key]} <span className="ml-0.5 tabular-nums opacity-70">{counts[key]}</span>
                </button>
              ))}
            </div>
            <div className="relative sm:ml-auto sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
              <input
                type="search"
                aria-label="Search forms"
                placeholder="Search forms"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>

          {forms === null && !error ? (
            <div aria-busy="true" aria-label="Loading forms" className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100 dark:bg-slate-700/60 motion-reduce:animate-none" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div data-testid="forms-empty-state" className="flex flex-col items-center px-6 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300">
                <ClipboardList className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="mt-4 text-base font-semibold text-gray-900 dark:text-white">{forms?.length ? 'No forms match' : 'No forms yet'}</h2>
              <p className="mt-1 max-w-sm text-sm text-gray-600 dark:text-slate-400">
                {forms?.length ? 'Try another status or search.' : 'Collect vendor, press or volunteer applications any time of year — then put the form on a page.'}
              </p>
              {!forms?.length && canEdit && (
                <Link href="/admin/content/forms/new" className="mt-5 inline-flex min-h-[44px] items-center rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 hover:bg-accent-hover">
                  Create your first form
                </Link>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-slate-700" data-testid="forms-list">
              {shown.map((form) => (
                <li key={form.id} data-testid={`form-row-${form.id}`}>
                  <Link
                    href={`/admin/content/forms/${form.id}`}
                    className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-600 dark:hover:bg-slate-700/40 sm:grid-cols-[1fr_7rem_7rem_8rem]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900 group-hover:underline dark:text-white">{form.name}</span>
                      <span className="block truncate text-xs text-gray-500 dark:text-slate-400">/{form.slug}</span>
                    </span>
                    <FormStatusBadge status={form.status} />
                    <span className="text-sm text-gray-700 dark:text-slate-300 sm:text-right">
                      <span className="font-semibold tabular-nums">{form.applicationCount}</span> {form.applicationCount === 1 ? 'submission' : 'submissions'}
                    </span>
                    <span className="hidden text-right text-xs text-gray-500 dark:text-slate-400 sm:block">Updated {formatDate(form.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
