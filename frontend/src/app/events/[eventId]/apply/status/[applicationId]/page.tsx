// Public application status page (spec 011): reached from the confirmation
// email or right after submitting, with a signed token in the URL.
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import api from '@/services/api';
import { formatDate, money, PAYMENT_LABEL, STATUS_LABEL, STATUS_STYLE, type ApplicantApplication } from '@/lib/applications';
import ApplyShell from '../../ApplyShell';

const STATUS_COPY: Record<ApplicantApplication['status'], string> = {
  DRAFT: 'Your application is not finished yet.',
  SUBMITTED: 'We have your application and will review it soon.',
  WAITLISTED: 'You are on the waitlist. We will let you know as soon as a spot opens up.',
  APPROVED: 'You are in! Watch your email for logistics closer to the event.',
  REJECTED: 'We could not offer you a spot this time. Thank you for applying.',
  WITHDRAWN: 'This application has been withdrawn.',
};

function StatusContent({ params }: { params: { eventId: string; applicationId: string } }) {
  const token = useSearchParams().get('token');
  const [app, setApp] = useState<ApplicantApplication | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This link is missing its access token. Use the link from your email.');
      return;
    }
    api
      .get<ApplicantApplication>(`/applications/${params.applicationId}/status?token=${encodeURIComponent(token)}`)
      .then(setApp)
      .catch((err) => setError(err?.message || 'Application not found'));
  }, [params.applicationId, token]);

  return (
    <ApplyShell eventId={params.eventId} title="Your application">
      {(event) => {
        if (error) return <p role="alert" data-testid="apply-status-error" className="text-red-700 dark:text-red-300">{error}</p>;
        if (!app) return <p className="text-gray-600 dark:text-slate-400">Loading…</p>;
        const accountHref = event.organizationId ? `/organizations/${event.organizationId}/account` : null;
        return (
          <div className="space-y-6" data-testid="apply-status">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-gray-600 dark:text-slate-400">{app.form.name}{app.tier ? ` · ${app.tier.name}` : ''}</p>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{app.profile.businessName}</h2>
                </div>
                <span data-testid="apply-status-pill" className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLE[app.status]}`}>{STATUS_LABEL[app.status]}</span>
              </div>
              <p className="mt-4 text-gray-800 dark:text-slate-200">{STATUS_COPY[app.status]}</p>
              {app.status === 'APPROVED' && app.boothLabel && (
                <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">Placement: <strong>{app.boothLabel}</strong></p>
              )}
              {app.form.kind === 'PAID' && (
                <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">
                  Payment: {PAYMENT_LABEL[app.paymentStatus]}
                  {app.amounts.applicantPays > 0 ? ` · ${money(app.amounts.applicantPays)}` : ''}
                  {app.paymentStatus === 'PAYMENT_DUE' && app.paymentDueAt ? ` · due ${formatDate(app.paymentDueAt)}` : ''}
                </p>
              )}
              <p className="mt-4 text-xs text-gray-500 dark:text-slate-400">
                Submitted {formatDate(app.submittedAt, true)}{app.decidedAt ? ` · decided ${formatDate(app.decidedAt, true)}` : ''}
              </p>
            </div>

            {app.answers.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-5 sm:p-6">
                <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">What you told us</h3>
                <dl className="space-y-3">
                  {app.answers.map((a) => (
                    <div key={a.questionId}>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{a.label}</dt>
                      <dd className="text-sm text-gray-800 dark:text-slate-200">
                        {a.image ? <img src={a.image.urls.thumb} alt={a.label} className="mt-1 h-24 w-24 rounded object-cover" /> : Array.isArray(a.value) ? a.value.join(', ') : a.value === 'true' ? 'Yes' : a.value === 'false' ? 'No' : a.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {accountHref && (
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Want to see all your applications, withdraw, or update your card?{' '}
                <Link href={accountHref} className="text-brand-link font-semibold hover:underline">Sign in to your account</Link> with {app.profile ? 'the email you applied with' : 'your email'}.
              </p>
            )}
          </div>
        );
      }}
    </ApplyShell>
  );
}

export default function ApplicationStatusPage({ params }: { params: { eventId: string; applicationId: string } }) {
  return (
    <Suspense fallback={null}>
      <StatusContent params={params} />
    </Suspense>
  );
}
