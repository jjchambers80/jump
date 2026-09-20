'use client';

// Account › General (spec 030 feature A): photo, name, email (verified
// change), phone, preferred language and time zone for the signed-in user.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import SummaryRow from '@/app/admin/settings/SummaryRow';
import { GlobeIcon, UsersIcon } from '@/app/admin/settings/icons';
import { localeLabel } from '@/lib/locales';
import { browserTimeZone, timeZoneLabel } from '@/lib/timeZones';
import { Account, accountApi } from './accountApi';
import EmailDialog from './EmailDialog';
import LanguageDialog from './LanguageDialog';
import NameDialog from './NameDialog';
import PhoneDialog, { formatAccountPhone } from './PhoneDialog';
import PhotoCard from './PhotoCard';
import TimeZoneDialog from './TimeZoneDialog';
import { ReauthProvider } from './useReauth';

type Editor = 'name' | 'email' | 'phone' | 'language' | 'timeZone' | null;

const cardClass = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';
const listClass = 'mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700';
const linkButtonClass = 'text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-indigo-400';

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4.5 3h3l1.5 4-2 1.2a10 10 0 0 0 4.8 4.8L13 11l4 1.5v3a1.5 1.5 0 0 1-1.6 1.5A14 14 0 0 1 3 4.6 1.5 1.5 0 0 1 4.5 3z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="m3 6 7 5 7-5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4l2.5 1.5" />
    </svg>
  );
}

export default function AccountGeneralPage() {
  const { update: refreshSession } = useSession();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [savedMessage, setSavedMessage] = useState('');
  const [pendingBusy, setPendingBusy] = useState(false);
  const nameRowRef = useRef<HTMLButtonElement>(null);
  const emailRowRef = useRef<HTMLButtonElement>(null);
  const phoneRowRef = useRef<HTMLButtonElement>(null);
  const languageRowRef = useRef<HTMLButtonElement>(null);
  const timeZoneRowRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAccount(await accountApi.get());
    } catch (requestError: any) {
      setError(requestError.message || 'Unable to load your account.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (next: Exclude<Editor, null>) => {
    setSavedMessage('');
    setEditor(next);
  };
  const closeEditor = () => setEditor(null);

  // Refresh the JWT claims (name, avatar, locale, time zone) so the org menu
  // and formatting react now instead of at the next 60 s claims refresh.
  const finishSave = (saved: Account, message: string) => {
    setAccount(saved);
    setEditor(null);
    setSavedMessage(message);
    void refreshSession();
  };

  const runPending = async (action: () => Promise<Account>, message: string) => {
    try {
      setPendingBusy(true);
      setAccount(await action());
      setSavedMessage(message);
    } catch (requestError: any) {
      setSavedMessage(requestError.message || 'Something went wrong.');
    } finally {
      setPendingBusy(false);
    }
  };

  const browser = browserTimeZone();

  return (
    <ReauthProvider>
    <section aria-labelledby="account-general-heading">
      <h2 id="account-general-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
        <UsersIcon className="h-5 w-5 text-gray-700 dark:text-slate-300" />
        General
      </h2>

      {loading && (
        <div aria-label="Loading your account" className="mt-4 space-y-4">
          {[1, 2, 3].map((item) => (
            <div key={item} className={`${cardClass} animate-pulse`}>
              <div className="h-4 w-40 rounded bg-gray-200 dark:bg-slate-700" />
              <div className="mt-4 h-16 rounded-lg bg-gray-100 dark:bg-slate-700/70" />
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
          <h3 className="font-semibold text-red-800 dark:text-red-300">Your account could not be loaded</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
          <button type="button" onClick={load} className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500">
            Retry
          </button>
        </div>
      )}

      {!loading && account && (
        <div className="mt-4 space-y-4">
          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Profile photo</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Shown in the organization menu and wherever your name appears in Jump.</p>
            <PhotoCard account={account} onSaved={finishSave} />
          </div>

          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Personal information</h3>
            <div className={listClass}>
              <SummaryRow
                label="Edit name"
                leading={<UsersIcon />}
                primary={account.name || 'Add your name'}
                secondary="First and last name"
                buttonRef={nameRowRef}
                onClick={() => openEditor('name')}
              />
              <SummaryRow
                label="Change email address"
                leading={<MailIcon />}
                primary={account.email}
                secondary={account.pendingEmail ? `Pending confirmation: ${account.pendingEmail}` : 'Sign-in links and notifications go here'}
                buttonRef={emailRowRef}
                onClick={() => openEditor('email')}
              />
              {account.pendingEmail && (
                <div data-testid="account-email-pending" className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                  <span className="min-w-0 flex-1">
                    Check <span className="font-medium">{account.pendingEmail}</span> for a confirmation link. Your email stays{' '}
                    <span className="font-medium">{account.email}</span> until you use it.
                  </span>
                  <button type="button" disabled={pendingBusy} onClick={() => runPending(accountApi.resendEmailChange, 'Confirmation email sent again.')} className={linkButtonClass}>
                    Resend
                  </button>
                  <button type="button" disabled={pendingBusy} onClick={() => runPending(accountApi.cancelEmailChange, 'Email change cancelled.')} className={linkButtonClass}>
                    Cancel change
                  </button>
                </div>
              )}
              <SummaryRow
                label={account.phone ? 'Edit phone number' : 'Add phone number'}
                leading={<PhoneIcon />}
                primary={account.phone ? formatAccountPhone(account.phone) : 'Add a phone number'}
                secondary="Used for account recovery contact only"
                buttonRef={phoneRowRef}
                onClick={() => openEditor('phone')}
              />
            </div>
          </div>

          <div className={cardClass}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Preferences</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
              These apply to you when you&apos;re logged in to Jump. They don&apos;t change what your customers see on your online store.
            </p>
            <div className={listClass}>
              <SummaryRow
                label="Change preferred language"
                leading={<GlobeIcon />}
                primary={localeLabel(account.locale)}
                secondary="Preferred language"
                buttonRef={languageRowRef}
                onClick={() => openEditor('language')}
              />
              <SummaryRow
                label="Change time zone"
                leading={<ClockIcon />}
                primary={account.timeZone ? timeZoneLabel(account.timeZone) : `Browser default${browser ? ` (${timeZoneLabel(browser)})` : ''}`}
                secondary="Time zone"
                buttonRef={timeZoneRowRef}
                onClick={() => openEditor('timeZone')}
              />
            </div>
          </div>
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">{savedMessage}</div>

      {editor === 'name' && account && (
        <NameDialog account={account} returnFocusRef={nameRowRef} onClose={closeEditor} onSaved={(saved) => finishSave(saved, 'Name saved.')} />
      )}
      {editor === 'email' && account && (
        <EmailDialog account={account} returnFocusRef={emailRowRef} onClose={closeEditor} onSaved={(saved) => finishSave(saved, `Confirmation sent to ${saved.pendingEmail}.`)} />
      )}
      {editor === 'phone' && account && (
        <PhoneDialog account={account} returnFocusRef={phoneRowRef} onClose={closeEditor} onSaved={(saved) => finishSave(saved, saved.phone ? 'Phone number saved.' : 'Phone number removed.')} />
      )}
      {editor === 'language' && account && (
        <LanguageDialog account={account} returnFocusRef={languageRowRef} onClose={closeEditor} onSaved={(saved) => finishSave(saved, 'Language saved.')} />
      )}
      {editor === 'timeZone' && account && (
        <TimeZoneDialog account={account} returnFocusRef={timeZoneRowRef} onClose={closeEditor} onSaved={(saved) => finishSave(saved, 'Time zone saved.')} />
      )}
    </section>
    </ReauthProvider>
  );
}
