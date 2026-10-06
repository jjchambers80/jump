'use client';

// "Delete my data" (spec 040 card D, GDPR Art. 17). Plain-language preview of
// what happens — upcoming tickets cancelled with no refund (decision
// 2026-09-29), open applications withdrawn, RSVPs cancelled, ledger kept
// without the person — then a checkbox, an emailed six-digit code, and a
// grace period the buyer can cancel. Blockers (money in flight, an approved
// vendor place) are explained and stop the request.

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, Trash2 } from 'lucide-react';
import { formatEventDateTime } from '@/lib/eventTime';
import { useAccount } from './AccountContext';

interface Preview {
  ticketsToVoid: { id: string; ticketNumber: number; eventName: string; eventDate: string; eventTimezone: string | null }[];
  applicationsToWithdraw: { id: string; formName: string; eventName: string }[];
  rsvpsToCancel: { id: string; eventName: string }[];
  blockers: { code: string; message: string }[];
  scheduledFor: string | null;
  graceDays: number;
}

type Step = 'review' | 'code';

const CARD = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 sm:p-6';

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'Something went wrong'), { code: data.code, details: data.details });
  return data as T;
}

/** When it will happen to the buyer: their own clock (operational timestamp, spec 033). */
const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function DeleteDataCard() {
  const { org, profile, setProfile, href } = useAccount();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState<Step>('review');
  const [understood, setUnderstood] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPreview(await call<Preview>('/api/buyer/me/erasure', 'GET'));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('/api/buyer/me/erasure/request', 'POST');
      setStep('code');
    } catch (err: any) {
      if (err.code === 'ERASURE_BLOCKED' && err.details?.blockers) {
        setPreview((p) => (p ? { ...p, blockers: err.details.blockers } : p));
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      setError('Enter the 6-digit code from the email');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { scheduledFor } = await call<{ scheduledFor: string }>('/api/buyer/me/erasure/confirm', 'POST', { code: digits });
      setPreview((p) => (p ? { ...p, scheduledFor } : p));
      setProfile({ ...profile, erasureScheduledAt: scheduledFor });
      setStep('review');
      setCode('');
      setUnderstood(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelDeletion = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('/api/buyer/me/erasure', 'DELETE');
      setPreview((p) => (p ? { ...p, scheduledFor: null } : p));
      setProfile({ ...profile, erasureScheduledAt: null });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const heading = (
    <h3 id="privacy-delete-heading" className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-slate-100">
      <Trash2 aria-hidden className="h-4 w-4 text-red-600 dark:text-red-400" />
      Delete my data
    </h3>
  );
  const errorLine = error && (
    <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
      {error}
    </p>
  );

  if (!preview) {
    return (
      <section className={CARD} aria-labelledby="privacy-delete-heading" data-testid="delete-data">
        {heading}
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">{error ?? 'Checking your account…'}</p>
      </section>
    );
  }

  // Scheduled: the grace period is running.
  if (preview.scheduledFor) {
    return (
      <section className={CARD} aria-labelledby="privacy-delete-heading" data-testid="delete-data">
        {heading}
        <div role="status" className="mt-3 flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
          <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your data with {org.name} will be deleted on <strong>{whenLabel(preview.scheduledFor)}</strong>. Until then
            your account works as usual.
          </p>
        </div>
        <button
          type="button"
          onClick={cancelDeletion}
          disabled={busy}
          className="mt-4 rounded-[var(--theme-button-radius,8px)] px-4 py-2.5 font-semibold text-gray-800 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-60 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700"
        >
          {busy ? 'Cancelling…' : 'Cancel deletion'}
        </button>
        {errorLine}
      </section>
    );
  }

  const tickets = preview.ticketsToVoid;
  const blocked = preview.blockers.length > 0;

  return (
    <section className={CARD} aria-labelledby="privacy-delete-heading" data-testid="delete-data">
      {heading}
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Removes your name, email, phone, business profile and answers from {org.name}. After you confirm, you have{' '}
        {preview.graceDays} day{preview.graceDays === 1 ? '' : 's'} to change your mind.
      </p>

      <div className="mt-4 space-y-3 text-sm text-gray-700 dark:text-slate-300">
        {tickets.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-900/20" data-testid="delete-tickets">
            <p className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle aria-hidden className="h-4 w-4" />
              {tickets.length} upcoming ticket{tickets.length === 1 ? '' : 's'} will be cancelled with no refund
            </p>
            <ul className="mt-2 space-y-1 text-amber-900 dark:text-amber-100">
              {tickets.map((t) => (
                <li key={t.id}>
                  {t.eventName} · #{t.ticketNumber} · {formatEventDateTime(t.eventDate, t.eventTimezone)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-amber-900 dark:text-amber-200">
              Want your money back? <Link href={href()} className="font-semibold underline">Request a refund</Link> first,
              where the refund policy allows.
            </p>
          </div>
        )}
        <ul className="list-disc space-y-1 pl-5">
          {preview.applicationsToWithdraw.length > 0 && (
            <li>
              {preview.applicationsToWithdraw.length} open application{preview.applicationsToWithdraw.length === 1 ? '' : 's'} will be withdrawn.
            </li>
          )}
          {preview.rsvpsToCancel.length > 0 && (
            <li>
              {preview.rsvpsToCancel.length} upcoming RSVP{preview.rsvpsToCancel.length === 1 ? '' : 's'} will be cancelled.
            </li>
          )}
          <li>Order, payment and refund records are kept without your name or contact details, as the law requires.</li>
          <li>Download your data first if you want a copy — it can’t be recovered afterwards.</li>
        </ul>
      </div>

      {blocked ? (
        <div role="alert" className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-800 dark:bg-slate-900/60 dark:text-slate-200" data-testid="delete-blockers">
          <p className="font-semibold">Your data can’t be deleted yet</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {preview.blockers.map((b) => (
              <li key={b.code + b.message}>{b.message}</li>
            ))}
          </ul>
        </div>
      ) : step === 'review' ? (
        <div className="mt-5 space-y-4">
          <label className="flex items-start gap-3 text-sm text-gray-800 dark:text-slate-200">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            <span>
              {tickets.length > 0
                ? `I understand my ${tickets.length === 1 ? 'ticket' : `${tickets.length} tickets`} will be cancelled with no refund and my data can’t be recovered.`
                : 'I understand my data can’t be recovered once it is deleted.'}
            </span>
          </label>
          <button
            type="button"
            onClick={requestCode}
            disabled={!understood || busy}
            className="rounded-[var(--theme-button-radius,8px)] bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Email me a confirmation code'}
          </button>
        </div>
      ) : (
        <form onSubmit={confirm} noValidate className="mt-5 space-y-3" data-testid="delete-code-form">
          <p className="text-sm text-gray-700 dark:text-slate-300">
            We sent a 6-digit code to <strong>{profile.email}</strong>. It expires in 10 minutes.
          </p>
          <label htmlFor="delete-code" className="block text-sm font-semibold text-gray-700 dark:text-slate-300">
            Confirmation code
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="delete-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              className="w-40 rounded-lg border border-gray-300 px-4 py-2.5 font-mono text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
            <button type="submit" disabled={busy} className="rounded-[var(--theme-button-radius,8px)] bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
              {busy ? 'Confirming…' : 'Delete my data'}
            </button>
          </div>
          <button type="button" onClick={() => { setStep('review'); setError(null); }} className="text-sm font-semibold text-brand-link hover:underline">
            Cancel
          </button>
        </form>
      )}
      {errorLine}
    </section>
  );
}
