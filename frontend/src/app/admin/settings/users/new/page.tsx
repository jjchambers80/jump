// Settings › Users › Add users. One role and one sign-in requirement for every
// address entered; each person gets an email with a sign-in link and appears
// as Pending until they sign in. Channels (Shopify's POS split) don't exist
// in Jump, so there is no user-type choice.
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { membersApi, type InviteMembersResult, type MemberRole } from '@/services/api';
import { ChevronRightIcon, ShieldIcon } from '../../icons';
import {
  FLASH_KEY,
  ROLE_HELP,
  ROLE_LABEL,
  SettingsShell,
  cardClass,
  errorMessage,
  primaryBtn,
  secondaryBtn,
} from '../shared';

const MAX_EMAILS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split on commas, semicolons and whitespace; de-duplicate case-insensitively. */
function parseEmails(raw: string) {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    (EMAIL_RE.test(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
}

function summary(result: InviteMembersResult) {
  const parts: string[] = [];
  if (result.invited.length) {
    parts.push(`Invited ${result.invited.length === 1 ? result.invited[0] : `${result.invited.length} users`}.`);
  }
  if (result.alreadyMember.length) parts.push(`Already a member: ${result.alreadyMember.join(', ')}.`);
  if (result.emailFailed.length) {
    parts.push(`The invite email could not be sent to ${result.emailFailed.join(', ')} — use Resend invite.`);
  }
  return parts.join(' ');
}

export default function AddUsersPage() {
  const router = useRouter();
  const [rawEmails, setRawEmails] = useState('');
  const [role, setRole] = useState<MemberRole>('ORGANIZER');
  const [requireTwoStep, setRequireTwoStep] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { valid, invalid } = parseEmails(rawEmails);
  const tooMany = valid.length > MAX_EMAILS;
  const emailError =
    invalid.length > 0
      ? `Check ${invalid.length === 1 ? 'this address' : 'these addresses'}: ${invalid.join(', ')}`
      : tooMany
        ? `Add up to ${MAX_EMAILS} people at a time.`
        : valid.length === 0 && submitted
          ? 'Enter at least one email address.'
          : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid.length || tooMany || valid.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const result = await membersApi.invite({ emails: valid, role, requireTwoStep });
      try {
        sessionStorage.setItem(FLASH_KEY, summary(result));
      } catch {
        // Storage blocked: the list simply shows no message
      }
      router.push('/admin/settings/users');
    } catch (err) {
      setError(errorMessage(err, 'Could not add users'));
      setSaving(false);
    }
  };

  return (
    <SettingsShell>
      <section aria-labelledby="add-users-heading" className="min-w-0 flex-1">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-400">
          <Link href="/admin/settings/users" className="hover:underline">
            Users
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5" />
          <span aria-current="page" className="text-gray-900 dark:text-white">
            Add users
          </span>
        </nav>
        <h2 id="add-users-heading" className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
          Add users
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          <div className={cardClass}>
            <label htmlFor="invite-emails" className="block text-sm font-semibold text-gray-900 dark:text-white">
              Emails
            </label>
            <p id="invite-emails-help" className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              Separate addresses with commas or new lines. Each person gets an email with a sign-in link.
            </p>
            <textarea
              id="invite-emails"
              name="emails"
              rows={3}
              value={rawEmails}
              onChange={(e) => setRawEmails(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="sam@example.com, alex@example.com"
              aria-describedby={`invite-emails-help${emailError ? ' invite-emails-error' : ''}`}
              aria-invalid={emailError ? true : undefined}
              className="mt-3 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
            {emailError ? (
              <p id="invite-emails-error" className="mt-2 text-sm text-red-700 dark:text-red-400">
                {emailError}
              </p>
            ) : (
              valid.length > 0 && (
                <p className="mt-2 text-sm text-gray-600 dark:text-slate-400" aria-live="polite">
                  {valid.length === 1 ? '1 person' : `${valid.length} people`} will be added.
                </p>
              )
            )}
          </div>

          <div className={cardClass}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="two-step-label" className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <ShieldIcon className="h-4 w-4 text-gray-500 dark:text-slate-400" />
                  Secure sign-in method
                </h3>
                <p id="two-step-help" className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                  Requires two-step authentication with an authenticator app before they can use this
                  organization&apos;s admin. They set it up under Account › Security after their first sign-in.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={requireTwoStep}
                aria-labelledby="two-step-label"
                aria-describedby="two-step-help"
                onClick={() => setRequireTwoStep((v) => !v)}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 motion-reduce:transition-none ${
                  requireTwoStep ? 'bg-accent-500' : 'bg-gray-300 dark:bg-slate-600'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
                    requireTwoStep ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          <div role="radiogroup" aria-labelledby="role-label" aria-describedby="role-help" className={cardClass}>
            <h3 id="role-label" className="text-sm font-semibold text-gray-900 dark:text-white">
              Role
            </h3>
            <p id="role-help" className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              What they can do in this organization. You can change it later.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['ORGANIZER', 'ADMIN'] as MemberRole[]).map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-accent-500 ${
                    role === r
                      ? 'border-accent-500 bg-accent-50 dark:border-accent-400 dark:bg-accent-500/10'
                      : 'border-gray-300 hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-700/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="mt-0.5 h-4 w-4 accent-accent-600 dark:accent-accent-400"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{ROLE_LABEL[r]}</span>
                    <span className="mt-0.5 block text-sm text-gray-600 dark:text-slate-400">{ROLE_HELP[r]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <Link href="/admin/settings/users" className={secondaryBtn}>
              Cancel
            </Link>
            <button type="submit" className={primaryBtn} disabled={saving}>
              {saving ? 'Adding…' : valid.length > 1 ? `Add ${valid.length} users` : 'Add user'}
            </button>
          </div>
        </form>
      </section>
    </SettingsShell>
  );
}
