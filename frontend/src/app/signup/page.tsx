'use client';

// /signup — step 1: name the organization (spec 022).
// Creates the pending organization and moves to its next step. A user with an
// unfinished signup is sent straight to where they left off.

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SignupShell from './SignupShell';
import signupService from '@/services/signupService';
import { signupPathFor } from '@/lib/onboarding';
import { slugify } from '@/lib/slug';

function NameStep() {
  const router = useRouter();
  const params = useSearchParams();
  const fromAdmin = params.get('from_admin') === '1';
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    signupService
      .current()
      .then(({ organization }) => {
        if (cancelled) return;
        if (organization) router.replace(signupPathFor(organization));
        else setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setBusy(true);
      setError(null);
      const org = await signupService.start(name.trim(), fromAdmin ? 'admin' : 'public');
      router.push(signupPathFor(org));
    } catch (err: any) {
      setError(err.message || 'Could not create the organization');
      setBusy(false);
    }
  };

  const handle = slugify(name);

  return (
    <SignupShell title="Name your organization" subtitle="This is what attendees see on your store, tickets and emails. You can change it later.">
      {checking ? (
        <div className="py-6 flex justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 dark:border-white" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="signup-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
              Organization name
            </label>
            <input
              id="signup-name"
              type="text"
              value={name}
              autoFocus
              maxLength={255}
              onChange={(e) => setName(e.target.value)}
              placeholder="Raleigh Retro Gamers"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500 dark:focus:border-white dark:focus:ring-white"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400" data-testid="signup-handle">
              Store handle:{' '}
              <span className="font-mono text-gray-700 dark:text-slate-200">{handle || 'your-organization'}</span>
            </p>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="w-full rounded-full bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 transition disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Continue'}
          </button>
        </form>
      )}
    </SignupShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <NameStep />
    </Suspense>
  );
}
