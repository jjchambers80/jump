// Email change confirmation (spec 040 PA-04): the link sent to the NEW
// address. The token is the proof, so this page sits outside the sign-in gate
// (the link often opens in a different browser from the one that asked).
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { storefrontHref } from '@/lib/storefrontPath';
import TokenPageShell from '@/components/account/TokenPageShell';

function ConfirmInner({ orgId }: { orgId: string }) {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<{ status: 'working' } | { status: 'done'; email: string } | { status: 'error'; message: string }>({ status: 'working' });
  const attempted = useRef(false);
  const accountHref = storefrontHref(`/organizations/${orgId}/account`, orgId);
  const profileHref = storefrontHref(`/organizations/${orgId}/account/profile`, orgId);

  useEffect(() => {
    if (attempted.current) return; // single use: never retry on re-render
    attempted.current = true;
    if (!token) {
      setState({ status: 'error', message: 'This confirmation link is missing its token.' });
      return;
    }
    (async () => {
      const res = await fetch('/api/buyer/me/email/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: 'error', message: body.message || 'This confirmation link is invalid or has expired.' });
        return;
      }
      setState({ status: 'done', email: body.email });
    })();
  }, [token]);

  if (state.status === 'working') return <p className="text-gray-600 dark:text-slate-400">Confirming your new email…</p>;

  const ok = state.status === 'done';
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <>
      <Icon aria-hidden className={`mx-auto mb-4 h-10 w-10 ${ok ? 'text-brand-link' : 'text-gray-400 dark:text-slate-500'}`} />
      <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-slate-100">{ok ? 'Email address updated' : "That link didn't work"}</h1>
      <p role={ok ? 'status' : 'alert'} className="mb-6 text-gray-600 dark:text-slate-400">
        {ok ? (
          <>
            Sign-in links, tickets and receipts now go to <strong>{state.email}</strong>.
          </>
        ) : (
          state.message
        )}
      </p>
      <Link href={ok ? accountHref : profileHref} className="inline-block rounded-[var(--theme-button-radius,8px)] bg-brand px-5 py-2.5 font-semibold text-brand-fg hover:bg-brand-hover">
        {ok ? 'Go to your account' : 'Try again from your profile'}
      </Link>
    </>
  );
}

export default function EmailConfirmPage({ params }: { params: { orgId: string } }) {
  return (
    <TokenPageShell orgId={params.orgId}>
      <Suspense fallback={<p className="text-gray-600 dark:text-slate-400">Confirming your new email…</p>}>
        <ConfirmInner orgId={params.orgId} />
      </Suspense>
    </TokenPageShell>
  );
}
