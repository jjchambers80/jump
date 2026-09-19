'use client';

// Online store › Preferences — /admin/online-store/preferences
// Store access (private mode + password + visitor message), the storefront
// homepage's search engine listing, and automatic language redirection for
// the organization picked in the header org switcher. Each section saves on
// its own through PATCH /admin/online-store/preferences (partial).

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import api, { type StorefrontPreferences, type StorefrontPreferencesInput } from '@/services/api';
import { SEO_TITLE_MAX, SEO_DESCRIPTION_MAX } from '../pages/PageForm';

// Mirrored from backend/src/utils/pageLimits.js.
const MESSAGE_MAX = 500;
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 100;

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const label = 'block text-sm font-medium text-gray-700 dark:text-slate-300';
const hint = 'mt-1 text-xs text-gray-500 dark:text-slate-400';
const card =
  'space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6';
const saveButton =
  'rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

function Toggle({
  id,
  checked,
  onChange,
  disabled,
  label: ariaLabel,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-600'
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function SectionStatus({ error, saved }: { error: string | null; saved: boolean }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error}
      </p>
    );
  }
  if (saved) {
    return (
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        Saved
      </p>
    );
  }
  return null;
}

function errorMessage(err: any, fallback: string) {
  const detail = Array.isArray(err?.details) ? err.details[0]?.message : null;
  return detail || err?.message || fallback;
}

export default function PreferencesPage() {
  const { selectedOrgId, selectedOrg, loading: orgLoading, error: orgError } = useOrg();
  const [prefs, setPrefs] = useState<StorefrontPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Store access drafts
  const [privateMode, setPrivateMode] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessSaved, setAccessSaved] = useState(false);

  // Search engine listing drafts
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [seoSaving, setSeoSaving] = useState(false);
  const [seoError, setSeoError] = useState<string | null>(null);
  const [seoSaved, setSeoSaved] = useState(false);

  // Automatic redirection
  const [redirectSaving, setRedirectSaving] = useState(false);
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [redirectSaved, setRedirectSaved] = useState(false);

  const applyPrefs = useCallback((next: StorefrontPreferences) => {
    setPrefs(next);
    setPrivateMode(next.storefrontPrivate);
    setPassword('');
    setMessage(next.storefrontMessage ?? '');
    setSeoTitle(next.seoTitle ?? '');
    setSeoDescription(next.seoDescription ?? '');
  }, []);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setPrefs(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setAccessError(null);
    setSeoError(null);
    setRedirectError(null);
    setAccessSaved(false);
    setSeoSaved(false);
    setRedirectSaved(false);
    try {
      applyPrefs(await api.get<StorefrontPreferences>('/admin/online-store/preferences'));
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, applyPrefs]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const patch = async (body: StorefrontPreferencesInput) => {
    const next = await api.patch<StorefrontPreferences>('/admin/online-store/preferences', body);
    applyPrefs(next);
    return next;
  };

  const saveAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!prefs) return;
    setAccessSaving(true);
    setAccessError(null);
    setAccessSaved(false);
    try {
      const body: StorefrontPreferencesInput = {
        storefrontPrivate: privateMode,
        storefrontMessage: message.trim() || null,
      };
      if (password) body.password = password;
      await patch(body);
      setAccessSaved(true);
    } catch (err: any) {
      setAccessError(errorMessage(err, 'Failed to save store access'));
    } finally {
      setAccessSaving(false);
    }
  };

  const removePassword = async () => {
    if (!prefs) return;
    setAccessSaving(true);
    setAccessError(null);
    setAccessSaved(false);
    try {
      await patch({ storefrontPrivate: false, password: null });
      setAccessSaved(true);
    } catch (err: any) {
      setAccessError(errorMessage(err, 'Failed to remove the password'));
    } finally {
      setAccessSaving(false);
    }
  };

  const saveSeo = async (event: FormEvent) => {
    event.preventDefault();
    setSeoSaving(true);
    setSeoError(null);
    setSeoSaved(false);
    try {
      await patch({ seoTitle: seoTitle.trim() || null, seoDescription: seoDescription.trim() || null });
      setSeoSaved(true);
    } catch (err: any) {
      setSeoError(errorMessage(err, 'Failed to save the search engine listing'));
    } finally {
      setSeoSaving(false);
    }
  };

  const toggleRedirect = async (next: boolean) => {
    if (!prefs) return;
    const previous = prefs.autoRedirectLanguage;
    setPrefs({ ...prefs, autoRedirectLanguage: next });
    setRedirectSaving(true);
    setRedirectError(null);
    setRedirectSaved(false);
    try {
      await patch({ autoRedirectLanguage: next });
      setRedirectSaved(true);
    } catch (err: any) {
      setPrefs((current) => (current ? { ...current, autoRedirectLanguage: previous } : current));
      setRedirectError(errorMessage(err, 'Failed to save automatic redirection'));
    } finally {
      setRedirectSaving(false);
    }
  };

  const header = (
    <div className="mb-6" data-testid="preferences-header">
      <p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Online store</p>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Preferences</h1>
    </div>
  );

  if (orgLoading || loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        {header}
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          ))}
        </div>
      </div>
    );
  }

  if (!selectedOrgId || !prefs) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        {header}
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {loadError ?? orgError ?? 'Pick an organization from the menu in the top right.'}
        </p>
      </div>
    );
  }

  const storeName = selectedOrg?.name ?? 'Your store';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const homepageUrl = `${origin}/organizations/${selectedOrgId}`;
  const accessDirty =
    privateMode !== prefs.storefrontPrivate ||
    password.length > 0 ||
    (message.trim() || null) !== prefs.storefrontMessage;
  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const needsPassword = privateMode && !prefs.hasPassword && !password;
  const seoDirty =
    (seoTitle.trim() || null) !== prefs.seoTitle ||
    (seoDescription.trim() || null) !== prefs.seoDescription;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {header}

      <div className="space-y-6">
        {/* Store access */}
        <form onSubmit={saveAccess} aria-labelledby="store-access-heading" data-testid="store-access" className={card}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="store-access-heading" className="text-base font-semibold text-gray-900 dark:text-white">
                Store access
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                Restrict your storefront to visitors who know the password. Staff keep full access
                to the admin.
              </p>
            </div>
            <span
              data-testid="store-access-status"
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                prefs.storefrontPrivate
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              }`}
            >
              {prefs.storefrontPrivate ? 'Private' : 'Public'}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="private-mode" className={label}>
              Private mode
              <span className="mt-0.5 block text-xs font-normal text-gray-500 dark:text-slate-400">
                Visitors see a password page instead of your events. Off means the store is
                public even if a password is saved.
              </span>
            </label>
            <Toggle id="private-mode" checked={privateMode} onChange={setPrivateMode} label="Private mode" />
          </div>

          <div>
            <label htmlFor="store-password" className={label}>
              Password
            </label>
            <input
              id="store-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                // A password only matters while the store is private; typing
                // one is the intent to lock the store, so flip the switch too.
                if (event.target.value && !privateMode) setPrivateMode(true);
              }}
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              maxLength={PASSWORD_MAX}
              placeholder={prefs.hasPassword ? '••••••••  (leave blank to keep)' : 'Choose a password'}
              className={field}
            />
            <p className={hint}>
              {prefs.hasPassword
                ? prefs.storefrontPrivate
                  ? 'A password is set. Enter a new one to change it.'
                  : 'A password is saved but private mode is off, so visitors can still see your store. Turn on private mode and save to protect it.'
                : `At least ${PASSWORD_MIN} characters. Entering one turns on private mode.`}
            </p>
          </div>

          <div>
            <label htmlFor="store-message" className={label}>
              Custom message to your visitors
            </label>
            <textarea
              id="store-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MESSAGE_MAX}
              rows={3}
              placeholder="We're getting ready. Check back soon!"
              className={field}
            />
            <p className={hint}>
              Shown on the password page. {message.length} of {MESSAGE_MAX} characters used
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={accessSaving || !accessDirty || passwordTooShort || needsPassword}
              data-testid="store-access-save"
              className={saveButton}
            >
              {accessSaving ? 'Saving…' : 'Save'}
            </button>
            {prefs.hasPassword && (
              <button
                type="button"
                onClick={removePassword}
                disabled={accessSaving}
                data-testid="store-password-remove"
                className="text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
              >
                Remove password and make store public
              </button>
            )}
            {needsPassword && !accessError && (
              <p className="text-xs text-amber-700 dark:text-amber-400">Set a password to turn on private mode.</p>
            )}
            <SectionStatus error={accessError} saved={accessSaved} />
          </div>
        </form>

        {/* Social sharing image and SEO */}
        <form onSubmit={saveSeo} aria-labelledby="seo-heading" data-testid="homepage-seo" className={card}>
          <div>
            <h2 id="seo-heading" className="text-base font-semibold text-gray-900 dark:text-white">
              Social sharing image and SEO
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              Set how your homepage appears in search engine listings and when shared. Your cover
              image from Online store › Branding is used as the sharing image.
            </p>
          </div>

          <div
            data-testid="seo-preview"
            className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <p className="truncate text-xs text-gray-600 dark:text-slate-400">{homepageUrl}</p>
            <p className="mt-1 truncate text-lg text-blue-700 dark:text-blue-400">{seoTitle.trim() || storeName}</p>
            <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-slate-300">
              {seoDescription.trim() || 'Add a meta description to control the snippet shown under the title.'}
            </p>
          </div>

          <div>
            <label htmlFor="homepage-title" className={label}>
              Homepage title
            </label>
            <input
              id="homepage-title"
              value={seoTitle}
              onChange={(event) => setSeoTitle(event.target.value)}
              maxLength={SEO_TITLE_MAX}
              placeholder={storeName}
              className={field}
            />
            <p className={hint}>
              {seoTitle.length} of {SEO_TITLE_MAX} characters used
            </p>
          </div>

          <div>
            <label htmlFor="homepage-description" className={label}>
              Meta description
            </label>
            <textarea
              id="homepage-description"
              value={seoDescription}
              onChange={(event) => setSeoDescription(event.target.value)}
              maxLength={SEO_DESCRIPTION_MAX}
              rows={3}
              className={field}
            />
            <p className={hint}>
              {seoDescription.length} of {SEO_DESCRIPTION_MAX} characters used
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={seoSaving || !seoDirty} data-testid="seo-save" className={saveButton}>
              {seoSaving ? 'Saving…' : 'Save'}
            </button>
            <SectionStatus error={seoError} saved={seoSaved} />
          </div>
        </form>

        {/* Automatic redirection */}
        <section aria-labelledby="redirection-heading" data-testid="automatic-redirection" className={card}>
          <div>
            <h2 id="redirection-heading" className="text-base font-semibold text-gray-900 dark:text-white">
              Automatic redirection
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              Send visitors to the version of your store that fits them.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="auto-redirect-language" className={label}>
              Language
              <span className="mt-0.5 block text-xs font-normal text-gray-500 dark:text-slate-400">
                Redirect visitors to the language that matches their browser when available.
              </span>
            </label>
            <Toggle
              id="auto-redirect-language"
              checked={prefs.autoRedirectLanguage}
              onChange={toggleRedirect}
              disabled={redirectSaving}
              label="Language"
            />
          </div>
          <SectionStatus error={redirectError} saved={redirectSaved} />
        </section>
      </div>
    </div>
  );
}
