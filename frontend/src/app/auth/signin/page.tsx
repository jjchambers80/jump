// Sign-In Page — Magic Link + Google (T094)
// Per FR-045, Auth.js v5 integration

'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { startAuthentication } from '@simplewebauthn/browser';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

/** Only same-origin paths may be a post-sign-in destination. */
function safeCallbackUrl(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

function SignInForm() {
  const params = useSearchParams();
  // /signup and the edge middleware pass callbackUrl so a new organizer lands
  // back where they were going (spec 022)
  const callbackUrl = safeCallbackUrl(params.get('callbackUrl'), '/events');
  const devCallbackUrl = safeCallbackUrl(params.get('callbackUrl'), '/admin/dashboard');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Spec 030 B: optional password + passkey sign-in beside the magic link
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await signIn('password', { email, password, redirect: false, callbackUrl });
      if (result?.error) setError('Wrong email or password.');
      else window.location.href = result?.url || callbackUrl;
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskey() {
    setLoading(true);
    setError('');
    try {
      const optionsRes = await fetch(`${API_URL}/auth/passkey/options`, { method: 'POST' });
      if (!optionsRes.ok) throw new Error('options');
      const { challengeId, options } = await optionsRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch(`${API_URL}/auth/passkey/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, response: assertion }),
      });
      if (!verifyRes.ok) throw new Error('verify');
      const { bridgeToken } = await verifyRes.json();
      const result = await signIn('token-bridge', { token: bridgeToken, redirect: false, callbackUrl });
      if (result?.error) throw new Error('bridge');
      window.location.href = result?.url || callbackUrl;
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') setError('');
      else setError('Passkey sign-in failed. Try another method.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn('resend', {
        email,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError('Failed to send magic link. Please try again.');
      } else {
        setSent(true);
      }
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    await signIn('google', { callbackUrl });
  }

  if (sent) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 text-center">
          <div className="text-5xl mb-4">✉️</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Check your email
          </h1>
          <p className="text-gray-600 dark:text-slate-400 mb-4">
            We sent a sign-in link to{' '}
            <strong className="text-gray-900 dark:text-white">{email}</strong>
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-500">
            Click the link in the email to sign in. It expires in 24 hours.
          </p>
          <button
            onClick={() => {
              setSent(false);
              setEmail('');
            }}
            className="mt-6 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-2">
          Sign in to Jump
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 text-center mb-8">
          Use a passkey, your Google account, an email link or a password
        </p>

        {params.get('reason') === 'revoked' && (
          <div role="status" className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
            This device was logged out from your account&apos;s Devices settings. Sign in again to continue.
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Google Sign-In */}
        <button
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg py-2.5 px-4 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition mb-6"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Passkey sign-in (spec 030 B) */}
        <button
          type="button"
          onClick={handlePasskey}
          disabled={loading}
          data-testid="signin-passkey"
          className="w-full flex items-center justify-center gap-3 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg py-2.5 px-4 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition mb-6 -mt-3 disabled:opacity-50"
        >
          <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            <path d="M5 21v-1a5 5 0 0 1 5-5h1" />
            <circle cx="17" cy="16" r="2.5" />
            <path d="M17 18.5V22l1.5-1.5" />
          </svg>
          Sign in with a passkey
        </button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-slate-600" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400">
              or sign in with email
            </span>
          </div>
        </div>

        {/* Email field */}
        <label
          htmlFor="email"
          className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="w-full px-4 py-2.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 mb-4"
        />

        {/* Dev Sign-In — instant, no email needed */}
        <button
          type="button"
          disabled={loading || !email}
          onClick={async () => {
            setLoading(true);
            setError('');
            try {
              const result = await signIn('dev-email', {
                email,
                redirect: false,
                callbackUrl: devCallbackUrl,
              });
              if (result?.error) {
                setError('Sign-in failed. Make sure the email exists in the database.');
              } else if (result?.url) {
                window.location.href = result.url;
              }
            } catch {
              setError('An unexpected error occurred.');
            } finally {
              setLoading(false);
            }
          }}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white font-medium py-2.5 rounded-lg transition mb-3"
        >
          {loading ? 'Signing in...' : '⚡ Dev Sign-In (instant)'}
        </button>

        {/* Magic Link */}
        <form onSubmit={handleMagicLink}>
          <button
            type="submit"
            disabled={loading || !email}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white font-medium py-2.5 rounded-lg transition"
          >
            {loading ? 'Sending...' : 'Send Magic Link'}
          </button>
        </form>

        {/* Password sign-in (spec 030 B) — optional; most staff use a link, Google or a passkey */}
        <div className="mt-4">
          {!showPassword ? (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              className="w-full text-center text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Sign in with a password instead
            </button>
          ) : (
            <form onSubmit={handlePassword} data-testid="signin-password-form">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 mb-3"
              />
              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 dark:bg-slate-600 dark:hover:bg-slate-500 dark:disabled:bg-slate-700 text-white font-medium py-2.5 rounded-lg transition"
              >
                {loading ? 'Signing in...' : 'Sign in with password'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-500 dark:text-slate-400">
          Can&apos;t sign in?{' '}
          <Link href="/auth/recover" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Restore access with your secondary email
          </Link>
        </p>

        <p className="mt-6 text-center text-xs text-gray-500 dark:text-slate-400">
          Want to sell tickets on Jump?{' '}
          <Link href="/signup" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Create your organization
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
