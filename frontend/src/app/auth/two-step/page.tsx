'use client';

// Second step of sign-in (spec 030 C). The session cookie already exists
// with `mfa: 'pending'`; the middleware sends /admin here. A trusted-device
// cookie completes silently; otherwise the user enters an authenticator
// code, uses a security key (passkey) or a recovery code. Success redeems
// the proof through useSession().update({ mfaProof }).

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { startAuthentication } from '@simplewebauthn/browser';
import { twoStepApi } from '@/app/admin/account/accountApi';

type Mode = 'app' | 'recovery';

function safeCallbackUrl(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

function TwoStepForm() {
  const params = useSearchParams();
  const callbackUrl = safeCallbackUrl(params.get('callbackUrl'), '/admin/dashboard');
  const { data: session, status, update } = useSession();
  const [checkingTrusted, setCheckingTrusted] = useState(true);
  const [mode, setMode] = useState<Mode>('app');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const complete = async (proof: string, trustToken?: string) => {
    if (trustToken) {
      await fetch('/api/account/two-step/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trustToken }),
      }).catch(() => {});
    }
    await update({ mfaProof: proof });
    window.location.assign(callbackUrl);
  };

  // Already done (or 2FA off) → just go; trusted device → complete silently.
  useEffect(() => {
    if (status === 'loading' || started.current) return;
    started.current = true;
    if (status === 'unauthenticated') {
      window.location.assign(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }
    if (!session?.mfaPending) {
      window.location.assign(callbackUrl);
      return;
    }
    fetch('/api/account/two-step/trusted-check', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : { proof: null }))
      .then(async (body) => {
        if (body?.proof) await complete(body.proof);
        else setCheckingTrusted(false);
      })
      .catch(() => setCheckingTrusted(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (!checkingTrusted) inputRef.current?.focus();
  }, [checkingTrusted, mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await twoStepApi.verify(mode === 'app' ? { code: code.trim(), rememberDevice: remember } : { recoveryCode: code.trim(), rememberDevice: remember });
      await complete(result.proof, result.trustToken);
    } catch (err: any) {
      setError(err.code === 'TWO_STEP_LOCKED' ? err.message : mode === 'app' ? 'That code didn’t match. Codes change every 30 seconds — check your phone’s clock.' : 'That recovery code didn’t match or was already used.');
    } finally {
      setBusy(false);
    }
  };

  const useSecurityKey = async () => {
    setBusy(true);
    setError('');
    try {
      const options = await twoStepApi.passkeyOptions();
      const assertion = await startAuthentication({ optionsJSON: options as any });
      const result = await twoStepApi.verify({ passkey: assertion, rememberDevice: remember });
      await complete(result.proof, result.trustToken);
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') setError('Security key verification failed.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading' || checkingTrusted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <p role="status" className="text-sm text-gray-500 dark:text-slate-400">Checking this device…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-2">Verify it’s you</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 text-center mb-6">
          {mode === 'app' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your recovery codes. Each works once.'}
        </p>
        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
        <form onSubmit={submit}>
          <label htmlFor="two-step-code" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            {mode === 'app' ? 'Authenticator code' : 'Recovery code'}
          </label>
          <input
            ref={inputRef}
            id="two-step-code"
            value={code}
            onChange={(e) => setCode(mode === 'app' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
            inputMode={mode === 'app' ? 'numeric' : 'text'}
            autoComplete="one-time-code"
            placeholder={mode === 'app' ? '123456' : 'abcde-fghij'}
            required
            className="w-full px-4 py-2.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-center text-lg tracking-widest focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 mb-4"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 mb-4">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Remember this device for 30 days
          </label>
          <button
            type="submit"
            disabled={busy || (mode === 'app' ? code.length !== 6 : code.length < 10)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white font-medium py-2.5 rounded-lg transition"
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </form>
        <div className="mt-5 flex flex-col items-center gap-2 text-sm">
          <button type="button" onClick={useSecurityKey} disabled={busy} className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Use a security key or passkey
          </button>
          <button
            type="button"
            onClick={() => { setMode(mode === 'app' ? 'recovery' : 'app'); setCode(''); setError(''); }}
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {mode === 'app' ? 'Use a recovery code' : 'Use your authenticator app'}
          </button>
          <button type="button" onClick={() => signOut({ callbackUrl: '/auth/signin' })} className="text-gray-500 dark:text-slate-400 hover:underline">
            Sign out
          </button>
        </div>
        <p className="mt-6 text-center text-xs text-gray-500 dark:text-slate-400">
          Lost your app and codes?{' '}
          <Link href="/auth/recover" className="text-indigo-600 dark:text-indigo-400 hover:underline">Restore access</Link> with your secondary email.
        </p>
      </div>
    </div>
  );
}

export default function TwoStepPage() {
  return (
    <Suspense fallback={null}>
      <TwoStepForm />
    </Suspense>
  );
}
