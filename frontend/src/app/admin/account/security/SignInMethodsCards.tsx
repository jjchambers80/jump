'use client';

// Account › Security cards for spec 030 B: Passkeys, Password, Connected
// accounts, Secondary email. All mutations run through withReauth.

import { useRef, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { startRegistration } from '@simplewebauthn/browser';
import { KeyRound, Fingerprint, Mail, Link2 } from 'lucide-react';
import { useAccountFormat } from '@/lib/accountFormat';
import { accountApi, type AccountPasskey, type SecurityOverview } from '../accountApi';
import { isReauthCancelled, useReauth } from '../useReauth';
import PasswordDialog from './PasswordDialog';
import SecondaryEmailDialog from './SecondaryEmailDialog';

export const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const listClass = 'mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700';
const primaryButton = 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50';
const secondaryButton = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700';
const dangerButton = 'rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20';
const linkButton = 'text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-indigo-400';

interface CardProps {
  overview: SecurityOverview;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}

function CardHeader({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-gray-500 dark:text-slate-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function PasskeysCard({ overview, onChanged, onError }: CardProps) {
  const { withReauth } = useReauth();
  const { formatDateTime } = useAccountFormat();
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);

  const add = async () => {
    setBusy('add');
    try {
      const passkey = await withReauth(async () => {
        const options = await accountApi.passkeys.registerOptions();
        const response = await startRegistration({ optionsJSON: options as any });
        return accountApi.passkeys.registerVerify(response);
      });
      onChanged(`Passkey "${passkey.label}" added.`);
    } catch (error: any) {
      if (isReauthCancelled(error)) return;
      if (error?.name === 'NotAllowedError') return;
      if (error?.name === 'InvalidStateError') onError('That authenticator is already registered.');
      else onError(error.message || 'Unable to add the passkey.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (passkey: AccountPasskey) => {
    if (!window.confirm(`Remove passkey "${passkey.label}"? You won’t be able to sign in with it any more.`)) return;
    setBusy(passkey.id);
    try {
      await withReauth(() => accountApi.passkeys.remove(passkey.id));
      onChanged(`Passkey "${passkey.label}" removed.`);
    } catch (error: any) {
      if (!isReauthCancelled(error)) onError(error.message || 'Unable to remove the passkey.');
    } finally {
      setBusy(null);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    const label = renaming.label.trim();
    if (!label) return;
    setBusy(renaming.id);
    try {
      await accountApi.passkeys.rename(renaming.id, label);
      setRenaming(null);
      onChanged('Passkey renamed.');
    } catch (error: any) {
      onError(error.message || 'Unable to rename the passkey.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cardClass} data-testid="passkeys-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader icon={<Fingerprint aria-hidden="true" className="h-5 w-5" />} title="Passkeys">
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            <span className="mr-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Recommended</span>
            Sign in with your face, fingerprint, device PIN or a security key. Passkeys can&apos;t be phished or guessed.
          </p>
        </CardHeader>
        <button type="button" onClick={add} disabled={busy !== null} className={primaryButton}>
          {busy === 'add' ? 'Waiting for your device…' : 'Add passkey'}
        </button>
      </div>
      {overview.passkeys.length > 0 && (
        <ul className={listClass}>
          {overview.passkeys.map((passkey) => (
            <li key={passkey.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="passkey-row">
              <span className="min-w-0 flex-1">
                {renaming?.id === passkey.id ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void saveRename(); }}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <label htmlFor={`passkey-label-${passkey.id}`} className="sr-only">Passkey name</label>
                    <input
                      id={`passkey-label-${passkey.id}`}
                      value={renaming.label}
                      onChange={(e) => setRenaming({ id: passkey.id, label: e.target.value })}
                      maxLength={80}
                      autoFocus
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button type="submit" disabled={busy !== null} className={linkButton}>Save</button>
                    <button type="button" onClick={() => setRenaming(null)} className={linkButton}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">{passkey.label}</span>
                    <span className="block text-sm text-gray-600 dark:text-slate-400">
                      Added {formatDateTime(passkey.createdAt, { dateStyle: 'medium' })}
                      {passkey.lastUsedAt ? ` · Last used ${formatDateTime(passkey.lastUsedAt, { dateStyle: 'medium' })}` : ' · Never used'}
                      {passkey.backedUp ? ' · Synced' : ''}
                    </span>
                  </>
                )}
              </span>
              {renaming?.id !== passkey.id && (
                <span className="flex gap-2">
                  <button type="button" onClick={() => setRenaming({ id: passkey.id, label: passkey.label })} disabled={busy !== null} className={secondaryButton} aria-label={`Rename passkey ${passkey.label}`}>
                    Rename
                  </button>
                  <button type="button" onClick={() => remove(passkey)} disabled={busy !== null} className={dangerButton} aria-label={`Remove passkey ${passkey.label}`}>
                    {busy === passkey.id ? 'Removing…' : 'Remove'}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {overview.passkeys.length === 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">No passkeys yet.</p>
      )}
    </div>
  );
}

export function PasswordCard({ overview, onChanged, onError }: CardProps) {
  const { withReauth } = useReauth();
  const { formatDateTime } = useAccountFormat();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const remove = async () => {
    if (!window.confirm('Remove your password? You can still sign in with an email link, Google or a passkey.')) return;
    setBusy(true);
    try {
      await withReauth(() => accountApi.password.remove());
      onChanged('Password removed.');
    } catch (error: any) {
      if (!isReauthCancelled(error)) onError(error.message || 'Unable to remove the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardClass} data-testid="password-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader icon={<KeyRound aria-hidden="true" className="h-5 w-5" />} title="Password">
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            {overview.password.set
              ? `Last changed ${overview.password.updatedAt ? formatDateTime(overview.password.updatedAt, { dateStyle: 'medium' }) : 'unknown'}.`
              : 'No password. You sign in with an email link, Google or a passkey.'}
          </p>
        </CardHeader>
        <span className="flex gap-2">
          <button ref={buttonRef} type="button" onClick={() => setDialog(true)} disabled={busy} className={overview.password.set ? secondaryButton : primaryButton}>
            {overview.password.set ? 'Change password' : 'Add password'}
          </button>
          {overview.password.set && (
            <button type="button" onClick={remove} disabled={busy} className={dangerButton}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
          )}
        </span>
      </div>
      {dialog && (
        <PasswordDialog
          hasPassword={overview.password.set}
          returnFocusRef={buttonRef}
          onClose={() => setDialog(false)}
          onSaved={(message) => { setDialog(false); onChanged(message); }}
        />
      )}
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = { google: 'Google' };

export function ConnectedAccountsCard({ overview, onChanged, onError }: CardProps) {
  const { withReauth } = useReauth();
  const [busy, setBusy] = useState<string | null>(null);
  const google = overview.providers.find((p) => p.provider === 'google');

  const disconnect = async (provider: string) => {
    const label = PROVIDER_LABEL[provider] ?? provider;
    if (!window.confirm(`Disconnect ${label}? You can still sign in with an email link to your account address${overview.password.set ? ' or your password' : ''}.`)) return;
    setBusy(provider);
    try {
      await withReauth(() => accountApi.providers.disconnect(provider));
      onChanged(`${label} disconnected.`);
    } catch (error: any) {
      if (!isReauthCancelled(error)) onError(error.message || `Unable to disconnect ${label}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cardClass} data-testid="connected-accounts-card">
      <CardHeader icon={<Link2 aria-hidden="true" className="h-5 w-5" />} title="Connected accounts">
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">External accounts you can use to sign in to Jump.</p>
      </CardHeader>
      <ul className={listClass}>
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-gray-900 dark:text-white">Google</span>
            <span className="block text-sm text-gray-600 dark:text-slate-400">
              {google ? `Connected${google.accountIdHint ? ` (${google.accountIdHint})` : ''}` : 'Not connected'}
            </span>
          </span>
          {google ? (
            <button type="button" onClick={() => disconnect('google')} disabled={busy !== null} className={dangerButton}>
              {busy === 'google' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button type="button" onClick={() => signIn('google', { callbackUrl: '/admin/account/security' })} className={secondaryButton}>
              Connect Google
            </button>
          )}
        </li>
      </ul>
    </div>
  );
}

export function SecondaryEmailCard({ overview, onChanged, onError }: CardProps) {
  const { withReauth } = useReauth();
  const { data: session } = useSession();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const secondary = overview.secondaryEmail;

  const resend = async () => {
    setBusy(true);
    try {
      await accountApi.secondaryEmail.resend();
      onChanged('Verification email sent again.');
    } catch (error: any) {
      onError(error.message || 'Unable to resend.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!secondary) return;
    if (!window.confirm(`Remove ${secondary.email}? It will no longer be able to restore access to your account.`)) return;
    setBusy(true);
    try {
      await withReauth(() => accountApi.secondaryEmail.remove());
      onChanged('Secondary email removed.');
    } catch (error: any) {
      if (!isReauthCancelled(error)) onError(error.message || 'Unable to remove the email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardClass} data-testid="secondary-email-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader icon={<Mail aria-hidden="true" className="h-5 w-5" />} title="Secondary email">
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            A secondary email can be used to restore access to your account. Security notifications are also sent to this email.
          </p>
        </CardHeader>
        {!secondary && (
          <button ref={buttonRef} type="button" onClick={() => setDialog(true)} className={primaryButton}>Add secondary email</button>
        )}
      </div>
      {secondary && (
        <div className={listClass}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-900 dark:text-white">{secondary.email}</span>
              <span className="block text-sm text-gray-600 dark:text-slate-400">
                {secondary.verified ? 'Verified' : 'Not verified yet — check that inbox for the link.'}
              </span>
            </span>
            <span className="flex gap-2">
              {!secondary.verified && (
                <button type="button" onClick={resend} disabled={busy} className={secondaryButton}>Resend</button>
              )}
              <button type="button" onClick={remove} disabled={busy} className={dangerButton}>{busy ? 'Working…' : 'Remove'}</button>
            </span>
          </div>
        </div>
      )}
      {dialog && (
        <SecondaryEmailDialog
          primaryEmail={session?.user?.email || ''}
          returnFocusRef={buttonRef}
          onClose={() => setDialog(false)}
          onSaved={(email) => { setDialog(false); onChanged(`Verification sent to ${email}.`); }}
        />
      )}
    </div>
  );
}
