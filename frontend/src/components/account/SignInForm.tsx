'use client';

// Passwordless sign-in for the patron account (spec 007 phase 2, spec 031):
// email → a magic link, or for CODE organizations a six-digit code entered
// here. The session cookie is httpOnly and set by /api/buyer/* route handlers.

import React, { useState } from 'react';
import { rememberNext } from '@/lib/buyerNext';
import type { AccountOrganization } from './AccountContext';

export default function SignInForm({
  org,
  nextPath,
  onSignedIn,
}: {
  org: AccountOrganization;
  /** Same-origin path to continue to after sign-in (checkout sends buyers here). */
  nextPath: string | null;
  onSignedIn: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Please enter a valid email address');
      return;
    }
    setFormError(null);
    setSending(true);
    rememberNext(nextPath || null);
    try {
      const res = await fetch('/api/buyer/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: org.id, email: email.trim().toLowerCase() }),
      });
      if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not send sign-in link');
      }
      setSent(true);
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSending(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      setCodeError('Enter the 6-digit code from the email');
      return;
    }
    setCodeError(null);
    setVerifying(true);
    try {
      const res = await fetch('/api/buyer/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: org.id, email: email.trim().toLowerCase(), code: digits }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || 'This code is incorrect or has expired');
      }
      setSent(false);
      setCode('');
      await onSignedIn();
    } catch (err: any) {
      setCodeError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 md:p-8">
      {sent ? (
        <div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-slate-100">Check your email</h2>
          {org.buyerSignInMethod === 'CODE' ? (
            <>
              <p className="text-gray-600 dark:text-slate-400">
                If <strong>{email}</strong> has an account with {org.name}, a 6-digit code is on its way. Enter it
                below — it expires in 10 minutes. The email also has a sign-in link if you prefer.
              </p>
              <form onSubmit={submitCode} noValidate className="mt-6" data-testid="sign-in-code-form">
                <label htmlFor="sign-in-code" className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-300">
                  Sign-in code
                </label>
                <div className="flex flex-wrap gap-3">
                  <input
                    id="sign-in-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={7}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    autoFocus
                    className="w-40 rounded-lg border border-gray-300 px-4 py-3 font-mono text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={verifying}
                    className="rounded-[var(--theme-button-radius,8px)] bg-brand px-5 py-3 font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60"
                  >
                    {verifying ? 'Checking…' : 'Continue'}
                  </button>
                </div>
                {codeError && (
                  <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {codeError}
                  </p>
                )}
              </form>
            </>
          ) : (
            <p className="text-gray-600 dark:text-slate-400">
              If <strong>{email}</strong> has an account with {org.name}, a sign-in link is on its way. It works once
              and expires in 15 minutes.
            </p>
          )}
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-6 text-sm font-semibold text-brand-link hover:underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={requestLink} noValidate>
          <h2 className="mb-1 text-xl font-semibold text-gray-900 dark:text-slate-100">Sign in</h2>
          <p className="mb-6 text-gray-600 dark:text-slate-400">
            No password. Enter the email you used at checkout and we&apos;ll send you a sign-in link.
          </p>
          <label htmlFor="buyer-email" className="mb-2 block text-sm font-semibold text-gray-700 dark:text-slate-300">
            Email Address
          </label>
          <input
            id="buyer-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFormError(null);
            }}
            disabled={sending}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? 'buyer-email-error' : undefined}
            className={`w-full rounded-lg border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand dark:bg-slate-700 dark:text-slate-100 ${
              formError ? 'border-red-500' : 'border-gray-300 dark:border-slate-600'
            }`}
            placeholder="your.email@example.com"
          />
          {formError && (
            <p id="buyer-email-error" className="mt-1 text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={sending}
            className="mt-6 w-full rounded-[var(--theme-button-radius,8px)] bg-brand py-3 font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60"
          >
            {sending ? 'Sending...' : 'Email me a sign-in link'}
          </button>
        </form>
      )}
    </div>
  );
}
