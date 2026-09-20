'use client';

// Restore access through a verified secondary email (spec 030 B). Always
// answers the same way so it never reveals whether an address is known.

import { FormEvent, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) setError('Too many requests. Try again later.');
      else setSent(true);
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-2">Restore access</h1>
        {sent ? (
          <p role="status" className="text-sm text-gray-600 dark:text-slate-400 text-center">
            If <strong className="text-gray-900 dark:text-white">{email.trim()}</strong> is a verified secondary email on a Jump account, we&apos;ve sent it a sign-in link. It expires in 15 minutes.
          </p>
        ) : (
          <form onSubmit={submit}>
            <p className="text-sm text-gray-500 dark:text-slate-400 text-center mb-6">
              Enter the secondary email you added under Account › Security. We&apos;ll send it a one-time sign-in link for your account.
            </p>
            {error && <div role="alert" className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">{error}</div>}
            <label htmlFor="recover-email" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Secondary email</label>
            <input
              id="recover-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button type="submit" disabled={loading || !email} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-medium py-2.5 rounded-lg transition">
              {loading ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-xs text-gray-500 dark:text-slate-400">
          <Link href="/auth/signin" className="text-indigo-600 dark:text-indigo-400 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
