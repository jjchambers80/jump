// Profile (spec 040 PA-03, PA-04, PA-09): the buyer corrects their own name,
// phone and city, changes their email through a link sent to the new
// address, and can sign out every other device.
'use client';

import React, { useState } from 'react';
import { LogOut, MailCheck } from 'lucide-react';
import { useAccount, type AccountProfile } from '@/components/account/AccountContext';

type Fields = { firstName: string; lastName: string; phone: string; location: string };

const fieldsOf = (p: AccountProfile): Fields => ({
  firstName: p.firstName ?? '',
  lastName: p.lastName ?? '',
  phone: p.phone ?? '',
  location: p.location ?? '',
});

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'Something went wrong'), { code: data.code });
  return data as T;
}

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100';
const LABEL = 'mb-1.5 block text-sm font-semibold text-gray-700 dark:text-slate-300';
const CARD = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200 dark:bg-slate-800 dark:ring-slate-700 sm:p-6';

function DetailsCard() {
  const { profile, setProfile } = useAccount();
  const [fields, setFields] = useState<Fields>(() => fieldsOf(profile));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const saved = fieldsOf(profile);
  const dirty = (Object.keys(fields) as (keyof Fields)[]).filter((k) => fields[k].trim() !== saved[k]);

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setMessage(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dirty.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const body = Object.fromEntries(dirty.map((k) => [k, fields[k]]));
      const next = await send<AccountProfile>('/api/buyer/me', 'PATCH', body);
      setProfile({ ...profile, ...next });
      setFields(fieldsOf(next));
      setMessage({ tone: 'ok', text: 'Saved.' });
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className={CARD} aria-labelledby="profile-details-heading" noValidate>
      <h3 id="profile-details-heading" className="text-base font-semibold text-gray-900 dark:text-slate-100">
        Your details
      </h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Used on your tickets and when the organizer needs to reach you.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-first" className={LABEL}>First name</label>
          <input id="profile-first" autoComplete="given-name" required value={fields.firstName} onChange={set('firstName')} className={INPUT} />
        </div>
        <div>
          <label htmlFor="profile-last" className={LABEL}>Last name</label>
          <input id="profile-last" autoComplete="family-name" required value={fields.lastName} onChange={set('lastName')} className={INPUT} />
        </div>
        <div>
          <label htmlFor="profile-phone" className={LABEL}>
            Phone <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
          </label>
          <input id="profile-phone" type="tel" autoComplete="tel" value={fields.phone} onChange={set('phone')} className={INPUT} />
        </div>
        <div>
          <label htmlFor="profile-location" className={LABEL}>
            City or region <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
          </label>
          <input id="profile-location" autoComplete="address-level2" value={fields.location} onChange={set('location')} className={INPUT} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || dirty.length === 0}
          className="rounded-[var(--theme-button-radius,8px)] bg-brand px-5 py-2.5 font-semibold text-brand-fg hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}

function EmailCard() {
  const { profile, setProfile, org } = useAccount();
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = profile.pendingEmail;

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setError('Enter a valid email address');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { pendingEmail } = await send<{ pendingEmail: string }>('/api/buyer/me/email', 'POST', { newEmail: newEmail.trim() });
      setProfile({ ...profile, pendingEmail });
      setEditing(false);
      setNewEmail('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await send('/api/buyer/me/email', 'DELETE');
      setProfile({ ...profile, pendingEmail: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-labelledby="profile-email-heading">
      <h3 id="profile-email-heading" className="text-base font-semibold text-gray-900 dark:text-slate-100">
        Email
      </h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Sign-in links, tickets and receipts from {org.name} go here.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-gray-900 dark:text-slate-100" data-testid="profile-email">
          {profile.email}
        </p>
        {!editing && !pending && (
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-brand-link hover:underline">
            Change email
          </button>
        )}
      </div>

      {pending && (
        <div role="status" className="mt-4 flex flex-col gap-3 rounded-xl bg-gray-50 p-4 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between" data-testid="profile-email-pending">
          <p className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-slate-300">
            <MailCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-link" />
            <span>
              We sent a confirmation link to <strong>{pending}</strong>. Your email changes when you open it (within an hour).
            </span>
          </p>
          <button type="button" onClick={cancel} disabled={busy} className="shrink-0 text-sm font-semibold text-brand-link hover:underline disabled:opacity-60">
            Cancel change
          </button>
        </div>
      )}

      {editing && (
        <form onSubmit={request} noValidate className="mt-4 space-y-3">
          <div>
            <label htmlFor="profile-new-email" className={LABEL}>New email address</label>
            <input
              id="profile-new-email"
              type="email"
              autoComplete="email"
              autoFocus
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'profile-new-email-error' : 'profile-new-email-hint'}
              className={INPUT}
            />
            {error ? (
              <p id="profile-new-email-error" role="alert" className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <p id="profile-new-email-hint" className="mt-1.5 text-sm text-gray-500 dark:text-slate-400">
                We&apos;ll email a link to the new address. Nothing changes until you open it.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className="rounded-[var(--theme-button-radius,8px)] bg-brand px-5 py-2.5 font-semibold text-brand-fg hover:bg-brand-hover disabled:opacity-60">
              {busy ? 'Sending…' : 'Send confirmation link'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError(null); }} className="rounded-[var(--theme-button-radius,8px)] px-4 py-2.5 font-semibold text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700">
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function DevicesCard() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    if (!window.confirm('Sign out of your account on every other phone, tablet and computer? You stay signed in here.')) return;
    setBusy(true);
    setError(null);
    try {
      await send('/api/buyer/me/sessions/revoke-all', 'POST', {});
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD} aria-labelledby="profile-devices-heading">
      <h3 id="profile-devices-heading" className="text-base font-semibold text-gray-900 dark:text-slate-100">
        Signed-in devices
      </h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Lost a phone or used a shared computer? Sign out everywhere except this browser.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={revoke}
          disabled={busy || done}
          className="inline-flex items-center gap-2 rounded-[var(--theme-button-radius,8px)] px-4 py-2.5 font-semibold text-gray-800 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-60 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700"
        >
          <LogOut aria-hidden className="h-4 w-4" />
          {busy ? 'Signing out…' : 'Sign out of all other devices'}
        </button>
        {done && <p role="status" className="text-sm text-gray-700 dark:text-slate-300">Done. Every other device is signed out.</p>}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </section>
  );
}

export default function AccountProfilePage() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Profile</h2>
      <DetailsCard />
      <EmailCard />
      <DevicesCard />
    </div>
  );
}
