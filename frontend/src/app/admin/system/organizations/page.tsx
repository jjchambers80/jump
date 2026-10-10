'use client';

// System administration › Organizations: every organization on the platform,
// unfinished signups included (GET /admin/system/organizations). q, status
// and page live in the URL so a filtered list can be shared and survives
// Back from the detail page. Replaces the old /admin/organizations page.

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ChevronRight, Search } from 'lucide-react';
import api, { systemAdminApi, type SystemOrgFilter, type SystemOrganizationPage } from '@/services/api';
import type { OnboardingFunnel } from '@/lib/onboarding';
import { useAccountFormat } from '@/lib/accountFormat';
import { Skeleton } from '../../dashboard/ui';
import { primaryBtn, secondaryBtn } from '../../settings/users/shared';
import { OrgStatusPill, planLabel, plural } from './shared';

// URL value → API filter. Readable words in the URL, API enums on the wire.
const FILTERS: { value: string; label: string; api?: SystemOrgFilter }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active', api: 'ACTIVE' },
  { value: 'suspended', label: 'Suspended', api: 'INACTIVE' },
  { value: 'unfinished', label: 'Unfinished signup', api: 'PENDING' },
];

const ROW_GRID = 'lg:grid lg:grid-cols-[minmax(0,2fr)_10rem_9rem_7rem_8rem_1rem] lg:items-center lg:gap-4';

function FunnelSection({ funnel }: { funnel: OnboardingFunnel }) {
  const windows = Object.keys(funnel.windows).sort((a, b) => Number(a) - Number(b));
  return (
    <details
      className="group mb-6 rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      data-testid="onboarding-funnel"
    >
      <summary className="flex min-h-[2.75rem] cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Signup funnel</h2>
        <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400">
          {funnel.pending} pending now
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        </span>
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-gray-200 p-4 dark:border-slate-700 sm:grid-cols-2">
        {windows.map((days) => {
          const w = funnel.windows[days];
          return (
            <div key={days} className="rounded-md bg-gray-50 p-3 dark:bg-slate-700/40" data-testid={`funnel-${days}`}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-slate-400">Last {days} days</h3>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                {(['started', 'completed', 'subscribed'] as const).map((key) => (
                  <div key={key}>
                    <dt className="text-xs capitalize text-gray-600 dark:text-slate-400">{key}</dt>
                    <dd className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{w[key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function CreateOrganization({ onCreated }: { onCreated: (name: string) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/organizations', { name: trimmed });
      setName('');
      onCreated(trimmed);
    } catch (err: any) {
      setError(err?.message || 'Could not create the organization.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end" aria-label="Create organization">
      <div className="min-w-0 flex-1">
        <label htmlFor="new-org-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
          New organization
        </label>
        <input
          id="new-org-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Organization name"
          aria-describedby={error ? 'new-org-error' : undefined}
          className="mt-1 block min-h-[2.75rem] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:min-h-0"
        />
      </div>
      <button type="submit" disabled={saving || !name.trim()} className={primaryBtn}>
        {saving ? 'Creating…' : 'Create'}
      </button>
      {error && (
        <p id="new-org-error" role="alert" className="text-sm text-red-700 dark:text-red-400 sm:basis-full">
          {error}
        </p>
      )}
    </form>
  );
}

function OrganizationsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { formatDateTime } = useAccountFormat();
  const q = params.get('q') ?? '';
  const filter = FILTERS.find((f) => f.value === params.get('status')) ?? FILTERS[0];
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<SystemOrganizationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<OnboardingFunnel | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => setSearchInput(q), [q]);

  const setQuery = (next: Record<string, string | number | undefined>) => {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '' || (key === 'page' && value === 1)) merged.delete(key);
      else merged.set(key, String(value));
    }
    router.replace(`${pathname}${merged.size ? `?${merged}` : ''}`, { scroll: false });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await systemAdminApi.organizations({ q, status: filter.api, page }));
    } catch (err: any) {
      setError(err?.message || 'Could not load organizations.');
    } finally {
      setLoading(false);
    }
  }, [q, filter.api, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Errors just hide the funnel; it is context, not the page's job.
  useEffect(() => {
    api.get<OnboardingFunnel>('/organizations/onboarding/funnel').then(setFunnel, () => setFunnel(null));
  }, []);

  const orgs = data?.organizations ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Organizations</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Every store on Eventimus, including signups that were never finished.</p>
      </header>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {funnel && <FunnelSection funnel={funnel} />}

      <CreateOrganization
        onCreated={(name) => {
          setAnnouncement(`Created ${name}`);
          void load();
        }}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          role="search"
          className="relative w-full lg:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ q: searchInput.trim(), page: undefined });
          }}
        >
          <label htmlFor="org-search" className="sr-only">
            Search organizations
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
          <input
            id="org-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or handle"
            maxLength={100}
            className="block min-h-[2.75rem] w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
        </form>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              aria-pressed={filter.value === f.value}
              onClick={() => setQuery({ status: f.value, page: undefined })}
              className={`min-h-[2.75rem] rounded-md px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 sm:min-h-0 sm:py-1.5 ${
                filter.value === f.value
                  ? 'bg-accent-500 text-gray-950'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={load} className={secondaryBtn}>
            Try again
          </button>
        </div>
      ) : (
        <section
          aria-label="Organizations"
          aria-busy={loading}
          className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800"
        >
          <div
            aria-hidden="true"
            className={`hidden border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 ${ROW_GRID}`}
          >
            <span>Organization</span>
            <span>Status</span>
            <span>Plan</span>
            <span>Members</span>
            <span>Created</span>
            <span />
          </div>

          {loading && !data ? (
            <ul aria-hidden="true" className="divide-y divide-gray-200 dark:divide-slate-700">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="px-4 py-4">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="mt-2 h-3 w-64" />
                </li>
              ))}
            </ul>
          ) : orgs.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-600 dark:text-slate-400">
              {q || filter.api ? 'No organizations match these filters.' : 'No organizations yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-slate-700" data-testid="system-org-list">
              {orgs.map((org) => (
                <li key={org.id}>
                  <Link
                    href={`/admin/system/organizations/${org.id}`}
                    className={`flex flex-col gap-2 px-4 py-3 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 dark:hover:bg-slate-700/50 ${ROW_GRID}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{org.name}</span>
                      <span className="block truncate text-xs text-gray-600 dark:text-slate-400">/{org.slug}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-slate-400 lg:contents lg:text-sm">
                      <span>
                        <OrgStatusPill org={org} />
                      </span>
                      <span>{planLabel(org)}</span>
                      <span>{plural(org.memberCount, 'member')}</span>
                      <span>
                        <span className="lg:sr-only">Created </span>
                        <time dateTime={org.createdAt}>{formatDateTime(org.createdAt, { dateStyle: 'medium' })}</time>
                      </span>
                    </span>
                    <ChevronRight className="hidden h-4 w-4 text-gray-400 lg:block" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pagination && pagination.total > 0 && (
            <nav
              aria-label="Pagination"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80"
            >
              <span className="text-sm text-gray-600 dark:text-slate-400">{plural(pagination.total, 'organization')}</span>
              {pagination.totalPages > 1 && (
                <div className="flex items-center gap-3">
                  <button type="button" className={secondaryBtn} disabled={page <= 1} onClick={() => setQuery({ page: page - 1 })}>
                    Previous
                  </button>
                  <span className="text-sm text-gray-600 dark:text-slate-400">
                    Page {page} of {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={page >= pagination.totalPages}
                    onClick={() => setQuery({ page: page + 1 })}
                  >
                    Next
                  </button>
                </div>
              )}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

export default function SystemOrganizationsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-6" aria-busy="true" />}>
      <OrganizationsContent />
    </Suspense>
  );
}
