'use client';

// System administration › Organizations › one organization: details, staff,
// and the platform actions — Open (switch into its admin), Suspend /
// Reactivate (step-up via withReauth), Discard for an unfinished signup.

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ExternalLink } from 'lucide-react';
import api, { systemAdminApi, type OrgMember, type SystemOrganization } from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import { ReauthProvider, isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import { MemberStatusPill, ROLE_LABEL, cardClass, errorMessage, primaryBtn, secondaryBtn } from '@/app/admin/settings/users/shared';
import { useAccountFormat } from '@/lib/accountFormat';
import { storefrontUrl } from '@/lib/publicPaths';
import { Skeleton } from '../../../dashboard/ui';
import { OrgStatusPill, planLabel, plural } from '../shared';

type Pending = 'suspend' | 'reactivate' | 'discard' | null;

const dangerBtn =
  'inline-flex min-h-[44px] items-center justify-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/40 sm:min-h-0';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900 dark:text-white">{children}</dd>
    </div>
  );
}

function OrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setSelectedOrgId } = useOrg();
  const { withReauth } = useReauth();
  const { formatDateTime } = useAccountFormat();
  const [org, setOrg] = useState<SystemOrganization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const actionRef = useRef<HTMLButtonElement>(null);
  const dialogBodyRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await systemAdminApi.organization(id);
      setOrg(data.organization);
      setMembers(data.members);
    } catch (err: any) {
      setError({ message: errorMessage(err, 'Could not load this organization.'), notFound: err?.status === 404 });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = () => {
    if (!org) return;
    // Publishes X-Jump-Org synchronously, so the dashboard's first fetch is scoped to this org.
    setSelectedOrgId(org.id);
    router.push('/admin/dashboard');
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!org || !pending) return;
    setSaving(true);
    setActionError(null);
    try {
      if (pending === 'discard') {
        await api.delete(`/signup/${org.id}`);
        router.push('/admin/system/organizations');
        return;
      }
      const next = await withReauth(() => systemAdminApi.setOrganizationStatus(org.id, pending === 'suspend' ? 'INACTIVE' : 'ACTIVE'));
      setOrg(next);
      setPending(null);
      setAnnouncement(`${next.name} is ${next.status === 'INACTIVE' ? 'suspended' : 'active again'}.`);
    } catch (err) {
      if (!isReauthCancelled(err)) setActionError(errorMessage(err, 'That did not work. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !org) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8" aria-busy="true">
        <p role="status" className="sr-only">
          Loading organization
        </p>
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-6 h-32 w-full" />
        <Skeleton className="mt-6 h-48 w-full" />
      </div>
    );
  }

  const back = (
    <Link
      href="/admin/system/organizations"
      className="inline-flex min-h-[2.75rem] items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-300 dark:hover:text-white sm:min-h-0"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Organizations
    </Link>
  );

  if (error || !org) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        {back}
        <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
          {error?.notFound ? 'Organization not found' : 'Organization'}
        </h1>
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error?.message}</span>
          {!error?.notFound && (
            <button type="button" onClick={load} className={secondaryBtn}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const unfinished = !org.onboardingCompletedAt;
  const suspended = org.status === 'INACTIVE';
  const date = (value: string) => formatDateTime(value, { dateStyle: 'medium' });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {back}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-bold text-gray-900 dark:text-white">{org.name}</h1>
            <span data-testid="org-status">
              <OrgStatusPill org={org} />
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">/{org.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {unfinished ? (
            <button ref={actionRef} type="button" className={dangerBtn} onClick={() => setPending('discard')}>
              Discard signup
            </button>
          ) : (
            <>
              <button type="button" className={primaryBtn} onClick={open}>
                Open
              </button>
              <button
                ref={actionRef}
                type="button"
                className={suspended ? secondaryBtn : dangerBtn}
                onClick={() => setPending(suspended ? 'reactivate' : 'suspend')}
              >
                {suspended ? 'Reactivate' : 'Suspend'}
              </button>
            </>
          )}
        </div>
      </header>

      {suspended && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          Suspended: the storefront is offline, checkout is refused and staff are locked out. Issued tickets stay valid.
        </p>
      )}

      <section aria-labelledby="org-details-heading" className={`mt-6 ${cardClass}`}>
        <h2 id="org-details-heading" className="text-base font-semibold text-gray-900 dark:text-white">
          Details
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Plan">{planLabel(org)}</Detail>
          <Detail label="Created">
            <time dateTime={org.createdAt}>{date(org.createdAt)}</time>
          </Detail>
          <Detail label="Setup">
            {org.onboardingCompletedAt ? (
              <>
                Completed <time dateTime={org.onboardingCompletedAt}>{date(org.onboardingCompletedAt)}</time>
              </>
            ) : (
              'Not finished'
            )}
          </Detail>
          <Detail label="Venues">{org.venueCount}</Detail>
          <Detail label="Staff">{plural(org.memberCount, 'member')}</Detail>
          <Detail label="Storefront">
            {unfinished || suspended ? (
              <span className="text-gray-600 dark:text-slate-400">Offline</span>
            ) : (
              <a
                href={storefrontUrl(org.slug)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-accent-700 underline hover:text-accent-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-accent-300"
              >
                View store
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </Detail>
        </dl>
      </section>

      <section aria-labelledby="org-members-heading" className={`mt-6 ${cardClass}`}>
        <h2 id="org-members-heading" className="text-base font-semibold text-gray-900 dark:text-white">
          Staff
        </h2>
        {members.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">No staff members.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-200 dark:divide-slate-700" data-testid="org-members">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{m.name || m.email}</p>
                  {m.name && <p className="truncate text-xs text-gray-600 dark:text-slate-400">{m.email}</p>}
                </div>
                <span className="text-sm text-gray-700 dark:text-slate-300">{ROLE_LABEL[m.role]}</span>
                <MemberStatusPill status={m.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && (
        <SettingsDialog
          titleId="org-action-title"
          title={
            pending === 'suspend' ? `Suspend ${org.name}?` : pending === 'reactivate' ? `Reactivate ${org.name}?` : `Discard ${org.name}?`
          }
          dirty={false}
          saving={saving}
          submitWhenClean
          submitLabel={pending === 'suspend' ? 'Suspend' : pending === 'reactivate' ? 'Reactivate' : 'Discard'}
          savingLabel="Working…"
          initialFocusRef={dialogBodyRef}
          returnFocusRef={actionRef}
          onClose={() => {
            setPending(null);
            setActionError(null);
          }}
          onSubmit={confirm}
        >
          <p ref={dialogBodyRef} tabIndex={-1} className="text-sm text-gray-700 focus:outline-none dark:text-slate-300">
            {pending === 'suspend' &&
              'The storefront goes offline, checkout and applications are refused, and staff are locked out of this organization. Tickets already sold stay valid and can still be scanned. You can reactivate it at any time.'}
            {pending === 'reactivate' && 'The storefront comes back online and staff can sign in to this organization again.'}
            {pending === 'discard' && 'This unfinished signup and its owner’s membership are deleted. This cannot be undone.'}
          </p>
          {actionError && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
              {actionError}
            </p>
          )}
        </SettingsDialog>
      )}
    </div>
  );
}

export default function SystemOrganizationPage() {
  return (
    <ReauthProvider>
      <OrganizationDetail />
    </ReauthProvider>
  );
}
