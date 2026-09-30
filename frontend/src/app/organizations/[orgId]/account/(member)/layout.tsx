// Patron account shell (spec 040, on spec 007 phase 2 / spec 031 sign-in).
// Signed out → the passwordless sign-in form; signed in → this
// organization's account: header, section nav, and the section page.
// `/account/verify` (and the other token pages) live outside this route
// group, so they never meet the sign-in gate. The session cookie is httpOnly
// and handled by /api/buyer/* route handlers.
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { safeNextPath, takeNext } from '@/lib/buyerNext';
import { storefrontHref } from '@/lib/storefrontPath';
import { api } from '@/services/api';
import BrandScope from '@/components/BrandScope';
import OrganizationHeader from '@/components/OrganizationHeader';
import SignInForm from '@/components/account/SignInForm';
import AccountNav from '@/components/account/AccountNav';
import {
  AccountContext,
  type AccountContextValue,
  type AccountOrganization,
  type AccountProfile,
  type AccountRsvp,
} from '@/components/account/AccountContext';
import type { ApplicantApplication } from '@/lib/applications';

export default function AccountLayout({ children, params }: { children: React.ReactNode; params: { orgId: string } }) {
  const router = useRouter();
  // Spec 031: ?next=<same-origin path> — where to go once signed in (checkout
  // sends buyers here). Read once from the URL so a later re-render cannot
  // resurrect it; kept in sessionStorage across the magic-link round trip.
  const nextPath = useRef<string | null>(null);
  if (nextPath.current === null && typeof window !== 'undefined') {
    nextPath.current = safeNextPath(new URLSearchParams(window.location.search).get('next')) ?? '';
  }
  const [org, setOrg] = useState<AccountOrganization | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [applications, setApplications] = useState<ApplicantApplication[] | null>(null);
  const [rsvps, setRsvps] = useState<AccountRsvp[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadApplications = useCallback(async () => {
    const res = await fetch('/api/buyer/me/applications', { cache: 'no-store' }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    setApplications(body?.data ?? []);
  }, []);

  const reloadRsvps = useCallback(async () => {
    const res = await fetch('/api/buyer/me/rsvps', { cache: 'no-store' }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    setRsvps(body?.data ?? []);
  }, []);

  const loadSession = useCallback(async () => {
    const me = await fetch('/api/buyer/me', { cache: 'no-store' });
    const data: AccountProfile | null = me.ok ? await me.json() : null;
    // Signed out is `null`. One cookie on the shared Jump domain; a session for another org counts as signed out here.
    if (!data || data.organization?.id !== params.orgId) {
      setProfile(null);
      return;
    }
    if (nextPath.current) {
      // Already signed in here: continue where the buyer was going.
      const target = nextPath.current;
      nextPath.current = '';
      router.replace(target);
      return;
    }
    setProfile(data);
    void reloadApplications();
    void reloadRsvps();
  }, [params.orgId, router, reloadApplications, reloadRsvps]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<{ organization: AccountOrganization }>(`/organizations/${params.orgId}/public`);
        if (!cancelled) setOrg(result.organization);
        await loadSession();
      } catch (err: any) {
        if (!cancelled) setOrgError(err.message || 'Organization not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.orgId, loadSession]);

  const onSignedIn = useCallback(async () => {
    // Signed in with a code: the stored return path (if any) wins, else load the account here.
    const next = takeNext();
    if (next) {
      router.replace(next);
      return;
    }
    setLoading(true);
    await loadSession();
    setLoading(false);
  }, [loadSession, router]);

  const signOut = async () => {
    await fetch('/api/buyer/logout', { method: 'POST' });
    setProfile(null);
    setApplications(null);
    setRsvps(null);
  };

  const context = useMemo<AccountContextValue | null>(
    () =>
      org && profile
        ? {
            org,
            profile,
            setProfile,
            applications,
            reloadApplications,
            rsvps,
            reloadRsvps,
            href: (section = '') =>
              storefrontHref(`/organizations/${org.id}/account${section ? `/${section}` : ''}`, org.id),
          }
        : null,
    [org, profile, applications, reloadApplications, rsvps, reloadRsvps]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-900">
        <p className="text-gray-600 dark:text-slate-400">Loading...</p>
      </div>
    );
  }

  if (orgError || !org) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-900">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-md dark:bg-slate-800">
          <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-slate-100">Organization Not Found</h2>
          <p className="text-gray-600 dark:text-slate-400">{orgError || 'This organization does not exist.'}</p>
        </div>
      </div>
    );
  }

  return (
    <BrandScope color={org.brandColor} themeMode={org.themeMode} className="min-h-screen bg-gray-50 dark:bg-slate-900 print:bg-white">
      {/* Receipts print on their own: header, greeting and nav are screen-only. */}
      <div className="print:hidden">
        <OrganizationHeader organization={{ id: org.id, name: org.name, logoUrl: org.logoUrl, storefrontLogo: org.storefrontLogo }} />
      </div>
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:pt-8 print:max-w-none print:p-0">
        {!context ? (
          <div className="py-6 sm:py-10">
            <h1 className="mb-2 text-center text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-3xl">
              Your account with {org.name}
            </h1>
            <p className="mb-8 text-center text-gray-600 dark:text-slate-400">Tickets, orders and applications in one place.</p>
            <SignInForm org={org} nextPath={nextPath.current} onSignedIn={onSignedIn} />
          </div>
        ) : (
          <AccountContext.Provider value={context}>
            <div className="mb-6 flex flex-col gap-1 sm:mb-8 print:hidden">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-link">Your account</p>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-3xl">
                {context.profile.firstName ? `Hi, ${context.profile.firstName}` : `Your account with ${org.name}`}
              </h1>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Signed in as {context.profile.email} ·{' '}
                <button type="button" onClick={signOut} className="font-semibold text-brand-link hover:underline">
                  Sign out
                </button>
              </p>
            </div>
            {context.profile.erasureScheduledAt && (
              <div role="status" data-testid="erasure-banner" className="mb-6 flex flex-col gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between print:hidden">
                <p>
                  Your data with {org.name} will be deleted on{' '}
                  {new Date(context.profile.erasureScheduledAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
                </p>
                <Link href={context.href('privacy')} className="font-semibold underline">
                  Cancel deletion
                </Link>
              </div>
            )}
            <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-10">
              <div className="lg:sticky lg:top-6 lg:self-start print:hidden">
                <AccountNav />
              </div>
              <div className="mt-6 min-w-0 lg:mt-0 print:col-span-2 print:mt-0">{children}</div>
            </div>
          </AccountContext.Provider>
        )}
      </main>
    </BrandScope>
  );
}
