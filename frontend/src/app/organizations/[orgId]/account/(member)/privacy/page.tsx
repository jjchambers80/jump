// Privacy (spec 040): what this organization holds about the buyer and the
// buyer's rights over it. Card C: "Download my data" (GDPR Art. 15 / 20).
// Card D: "Delete my data" (DeleteDataCard).
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { LEGAL_PAGES_ENABLED, LEGAL_PATHS } from '@/lib/legal';
import { useAccount } from '@/components/account/AccountContext';
import DeleteDataCard from '@/components/account/DeleteDataCard';

const CARD = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 sm:p-6';

function filenameFrom(disposition: string | null) {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'my-data.json';
}

function DownloadCard() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/buyer/me/export', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Could not prepare your data');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFrom(res.headers.get('Content-Disposition'));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage({ tone: 'ok', text: 'Your file is downloading.' });
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-labelledby="privacy-download-heading">
      <h3 id="privacy-download-heading" className="text-base font-semibold text-gray-900 dark:text-slate-100">
        Download my data
      </h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        One file with your details, orders, payments and refunds, tickets, RSVPs, applications and the consents you gave.
        It&apos;s in JSON, a format other apps can read.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={download}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60"
        >
          <Download aria-hidden className="h-4 w-4" />
          {busy ? 'Preparing…' : 'Download my data'}
        </button>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

export default function AccountPrivacyPage() {
  const { org, href } = useAccount();
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Privacy</h2>

      <section className={CARD} aria-labelledby="privacy-about-heading">
        <h3 id="privacy-about-heading" className="text-base font-semibold text-gray-900 dark:text-slate-100">
          Your data with {org.name}
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          {org.name} keeps the details you gave when you bought tickets, RSVP&apos;d or applied, and uses Jump to run its
          storefront. This page covers {org.name} only — other organizers on Jump keep their own records.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-gray-700 dark:text-slate-300">
          <li>
            <Link href={href('profile')} className="font-semibold text-brand-link hover:underline">Correct your details</Link>{' '}
            — name, phone, city and email.
          </li>
          <li>
            <Link href={href('preferences')} className="font-semibold text-brand-link hover:underline">Stop marketing email</Link>{' '}
            — one switch, any time.
          </li>
          {LEGAL_PAGES_ENABLED && (
            <li>
              <Link href={LEGAL_PATHS.privacy} className="font-semibold text-brand-link hover:underline">Privacy policy</Link>
            </li>
          )}
        </ul>
      </section>

      <DownloadCard />
      <DeleteDataCard />
    </div>
  );
}
