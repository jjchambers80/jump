// Public application status page (spec 011): reached from the confirmation
// email, right after submitting, or back from Stripe Checkout, with a signed
// token in the URL. Paid applications can resume an abandoned Checkout or pay
// an outstanding balance from here (phase 2); add-on lines (spec 012) are
// itemised under the amount.
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import { formatDate, money, PAYMENT_LABEL, STATUS_LABEL, STATUS_STYLE, type ApplicantApplication } from '@/lib/applications';
import ApplyShell from '../../ApplyShell';

const STATUS_COPY: Record<ApplicantApplication['status'], string> = {
  DRAFT: 'Your application is not finished yet — save a card or pay to submit it.',
  SUBMITTED: 'We have your application and will review it soon.',
  WAITLISTED: 'You are on the waitlist. We will let you know as soon as a spot opens up.',
  APPROVED: 'You are in! Watch your email for logistics closer to the event.',
  REJECTED: 'We could not offer you a spot this time. Thank you for applying.',
  WITHDRAWN: 'This application has been withdrawn.',
};

const CHECKOUT_NOTICE: Record<string, string> = {
  submitted: 'Thanks — your application is in. We will email you when the organizer decides.',
  paid: 'Payment received. Your spot is confirmed.',
  card_updated: 'Your card has been updated.',
  cancelled: 'Checkout was cancelled. You can pick up where you left off below.',
};

const PAYMENT_COPY: Partial<Record<ApplicantApplication['paymentStatus'], string>> = {
  AWAITING_CARD: 'No card saved yet.',
  CARD_ON_FILE: 'Your card is on file and will only be charged if you are accepted.',
  PROCESSING: 'Your payment is being confirmed.',
  PAYMENT_DUE: 'We could not charge the card on file. Pay below to keep your spot.',
};

function StatusContent({ params }: { params: { eventId: string; applicationId: string } }) {
  const search = useSearchParams();
  const token = search.get('token');
  const checkout = search.get('checkout');
  const [app, setApp] = useState<ApplicantApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) {
      setError('This link is missing its access token. Use the link from your email.');
      return;
    }
    api
      .get<ApplicantApplication>(`/applications/${params.applicationId}/status?token=${encodeURIComponent(token)}`)
      .then(setApp)
      .catch((err) => setError(err?.message || 'Application not found'));
  }, [params.applicationId, token]);

  useEffect(() => {
    load();
  }, [load]);

  // Back from Stripe: the webhook may land a beat after the redirect. Poll briefly
  // until the row reflects the payment / card, then stop.
  useEffect(() => {
    if (!checkout || !app || checkout === 'cancelled') return;
    const settled = checkout === 'submitted' ? app.status !== 'DRAFT' : checkout === 'paid' ? app.paymentStatus === 'PAID' : true;
    if (settled) return;
    const id = setTimeout(load, 2000);
    return () => clearTimeout(id);
  }, [checkout, app, load]);

  const goToCheckout = async (path: 'resume' | 'pay') => {
    if (!token || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await api.post<{ url: string }>(`/applications/${params.applicationId}/${path}?token=${encodeURIComponent(token)}`, {});
      window.location.assign(url);
    } catch (err) {
      setActionError((err as Error)?.message || 'Could not open checkout');
      setBusy(false);
    }
  };

  return (
    <ApplyShell eventId={params.eventId} title="Your application">
      {(event) => {
        if (error) return <p role="alert" data-testid="apply-status-error" className="text-red-700 dark:text-red-300">{error}</p>;
        if (!app) return <p className="text-gray-600 dark:text-slate-400">Loading…</p>;
        const accountHref = event.organizationId ? `/organizations/${event.organizationId}/account` : null;
        return (
          <div className="space-y-6" data-testid="apply-status">
            {checkout && CHECKOUT_NOTICE[checkout] && (
              <p role="status" data-testid="apply-checkout-notice" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
                {CHECKOUT_NOTICE[checkout]}
              </p>
            )}
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
                <div className="mt-3 rounded-lg bg-gray-50 dark:bg-slate-900/40 p-3 text-sm text-gray-700 dark:text-slate-300" data-testid="apply-payment">
                  <p>
                    <span className="font-semibold">Payment:</span> {PAYMENT_LABEL[app.paymentStatus]}
                    {app.amounts.applicantPays > 0 ? ` · ${money(app.amounts.applicantPays)}` : ''}
                    {app.paymentStatus === 'PAYMENT_DUE' && app.paymentDueAt ? ` · due ${formatDate(app.paymentDueAt)}` : ''}
                    {app.refundedTotal > 0 ? ` · ${money(app.refundedTotal)} refunded` : ''}
                  </p>
                  {app.addOns?.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-gray-600 dark:text-slate-400" data-testid="apply-add-ons">
                      <li className="flex justify-between gap-3">
                        <span>{app.tier?.name ?? app.form.name}</span>
                        <span>{money(app.amounts.applicantPays - app.addOns.reduce((s, l) => s + l.applicantPays, 0))}</span>
                      </li>
                      {app.addOns.map((l) => (
                        <li key={l.id} className="flex justify-between gap-3">
                          <span>{l.name} ×{l.quantity}</span>
                          <span>{money(l.applicantPays)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {app.status !== 'DRAFT' && PAYMENT_COPY[app.paymentStatus] && <p className="mt-1 text-gray-600 dark:text-slate-400">{PAYMENT_COPY[app.paymentStatus]}</p>}
                  {(app.canResume || app.canPay) && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => goToCheckout(app.canResume ? 'resume' : 'pay')}
                        disabled={busy}
                        data-testid={app.canResume ? 'apply-resume' : 'apply-pay-now'}
                        className="rounded-lg bg-brand px-4 py-2 font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60 transition-colors"
                      >
                        {busy ? 'Opening…' : app.canResume ? 'Finish submitting' : `Pay ${money(app.amounts.applicantPays)} now`}
                      </button>
                      {actionError && <span role="alert" className="text-red-700 dark:text-red-300">{actionError}</span>}
                    </div>
                  )}
                </div>
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
