// One-click unsubscribe from a marketing email (spec 040 PA-08). No sign-in:
// the link carries an HMAC token. Loading the page changes nothing — mail
// filters open links to scan them — so the visitor confirms with one click.
'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { MailX } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { storefrontHref } from '@/lib/storefrontPath';
import TokenPageShell from '@/components/account/TokenPageShell';

interface Info {
  organization: { id: string; name: string };
  email: string;
  emailSubscribed: boolean;
}

function UnsubscribeInner({ orgId }: { orgId: string }) {
  const t = useSearchParams().get('t') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preferencesHref = storefrontHref(`/organizations/${orgId}/account/preferences`, orgId);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/buyer/unsubscribe?t=${encodeURIComponent(t)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'This unsubscribe link is not valid');
        return body as Info;
      })
      .then((body) => !cancelled && setInfo(body))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const unsubscribe = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/buyer/unsubscribe?t=${encodeURIComponent(t)}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not unsubscribe');
      setInfo(body as Info);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <>
        <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-slate-100">That link didn&apos;t work</h1>
        <p role="alert" className="mb-6 text-gray-600 dark:text-slate-400">{error}. You can change your email preferences from your account.</p>
        <Link href={preferencesHref} className="font-semibold text-brand-link hover:underline">Email preferences</Link>
      </>
    );
  }
  if (!info) return <p className="text-gray-600 dark:text-slate-400">Loading…</p>;

  return (
    <>
      <MailX aria-hidden className="mx-auto mb-4 h-10 w-10 text-brand-link" />
      {info.emailSubscribed ? (
        <>
          <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-slate-100">Unsubscribe from {info.organization.name}?</h1>
          <p className="mb-6 text-gray-600 dark:text-slate-400">
            <strong>{info.email}</strong> will stop getting news and offers. Tickets, receipts and order updates still arrive.
          </p>
          <button
            type="button"
            onClick={unsubscribe}
            disabled={busy}
            className="w-full rounded-lg bg-brand px-5 py-3 font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? 'Unsubscribing…' : 'Unsubscribe'}
          </button>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-slate-100">You&apos;re unsubscribed</h1>
          <p role="status" className="mb-6 text-gray-600 dark:text-slate-400">
            <strong>{info.email}</strong> won&apos;t get news or offers from {info.organization.name}. Changed your mind? Sign in and turn them back on.
          </p>
          <Link href={preferencesHref} className="font-semibold text-brand-link hover:underline">Email preferences</Link>
        </>
      )}
    </>
  );
}

export default function UnsubscribePage({ params }: { params: { orgId: string } }) {
  return (
    <TokenPageShell orgId={params.orgId}>
      <Suspense fallback={<p className="text-gray-600 dark:text-slate-400">Loading…</p>}>
        <UnsubscribeInner orgId={params.orgId} />
      </Suspense>
    </TokenPageShell>
  );
}
