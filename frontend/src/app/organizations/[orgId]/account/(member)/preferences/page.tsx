// Email preferences (spec 040 PA-07): one switch for marketing email from this
// organization. Turning it off is a single click with no confirmation
// (withdrawing consent must be as easy as giving it); turning it on records
// the label shown as the consent text — the label comes from the backend.
'use client';

import { useState } from 'react';
import { useAccount } from '@/components/account/AccountContext';

export default function AccountPreferencesPage() {
  const { org, profile, setProfile } = useAccount();
  const subscribed = Boolean(profile.emailSubscribed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const label = profile.marketingConsentText || `Email me news and offers from ${org.name}. I can turn this off at any time.`;

  const toggle = async () => {
    const next = !subscribed;
    setBusy(true);
    setMessage(null);
    setProfile({ ...profile, emailSubscribed: next });
    try {
      const res = await fetch('/api/buyer/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailSubscribed: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'Could not save your preference');
      setMessage({ tone: 'ok', text: next ? `You'll get news and offers from ${org.name}.` : `You won't get news or offers from ${org.name}.` });
    } catch (err: any) {
      setProfile({ ...profile, emailSubscribed: subscribed });
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Email preferences</h2>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 sm:p-6" aria-labelledby="prefs-marketing-heading">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 id="prefs-marketing-heading" className="text-base font-semibold text-gray-900 dark:text-slate-100">
              News and offers
            </h3>
            <p id="prefs-marketing-label" className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              {label}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={subscribed}
            aria-labelledby="prefs-marketing-heading"
            aria-describedby="prefs-marketing-label"
            onClick={toggle}
            disabled={busy}
            data-testid="prefs-marketing-switch"
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full outline-none ring-offset-2 transition-colors focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 motion-reduce:transition-none dark:ring-offset-slate-800 ${
              subscribed ? 'bg-brand' : 'bg-gray-300 dark:bg-slate-600'
            }`}
          >
            <span
              aria-hidden
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${subscribed ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${message.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'}`}>
            {message.text}
          </p>
        )}
      </section>

      <p className="text-sm text-gray-600 dark:text-slate-400">
        Tickets, receipts, sign-in links and updates about your orders and applications always arrive — they are part of what you bought, not marketing.
      </p>
    </div>
  );
}
