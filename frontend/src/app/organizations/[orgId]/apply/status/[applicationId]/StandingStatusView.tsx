'use client';

import { useSearchParams } from 'next/navigation';
import { formatDate, STATUS_LABEL, type ApplicationStatus } from '@/lib/applications';
import StorefrontShell, { type StorefrontOrganization } from '@/components/storefront/StorefrontShell';
import { useStorefrontContent } from '@/components/storefront/useStorefrontContent';

interface StatusPayload {
  organization: StorefrontOrganization;
  form: { name: string };
  status: ApplicationStatus;
  submittedAt: string | null;
  decidedAt: string | null;
  profile: { businessName: string } | null;
}

const NEXT: Partial<Record<ApplicationStatus, string>> = {
  SUBMITTED: 'The organizer is reviewing your application. We will email you their decision.',
  WAITLISTED: 'You are on the waitlist. We will email you if a place opens up.',
  APPROVED: 'You are in. Watch your email for next steps from the organizer.',
  REJECTED: 'The organizer was not able to accept this application.',
  WITHDRAWN: 'This application was withdrawn.',
};

export default function StandingStatusView({ orgId, applicationId }: { orgId: string; applicationId: string }) {
  const token = useSearchParams().get('token') ?? '';
  const state = useStorefrontContent<StatusPayload>(
    `/organizations/${encodeURIComponent(orgId)}/public/apply/status/${encodeURIComponent(applicationId)}?token=${encodeURIComponent(token)}`
  );
  return (
    <StorefrontShell orgId={orgId} state={state} notFoundTitle="Application not found">
      {(app) => (
        <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">Your application</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">{app.form.name}</h1>
          <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800" data-testid="apply-status">
            <div className="flex items-baseline justify-between gap-3 px-5 py-4">
              <span className="text-sm text-gray-600 dark:text-slate-400">Status</span>
              <span className="text-lg font-bold text-gray-900 dark:text-white">{STATUS_LABEL[app.status]}</span>
            </div>
            <p className="border-t-2 border-dashed border-gray-200 px-5 py-4 text-gray-700 dark:border-slate-700 dark:text-slate-300">{NEXT[app.status]}</p>
            <dl className="grid gap-3 border-t border-gray-200 px-5 py-4 text-sm dark:border-slate-700 sm:grid-cols-2">
              {app.profile?.businessName && (
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Business</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">{app.profile.businessName}</dd>
                </div>
              )}
              {app.submittedAt && (
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Submitted</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">{formatDate(app.submittedAt)}</dd>
                </div>
              )}
            </dl>
          </div>
        </main>
      )}
    </StorefrontShell>
  );
}
