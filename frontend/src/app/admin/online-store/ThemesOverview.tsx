'use client';

// Online Store page for organizations in the themes rollout (spec 038 §10,
// card 038J1): store access, View store, the live theme card with Edit
// theme, and draft themes (038J2: rename, duplicate, publish, delete; 038K:
// preview and share preview links). Thumbnails and import come later.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import ActionsMenu from '@/components/ActionsMenu';
import { useOrg } from '@/components/OrgContext';
import api, { type StorefrontPreferences } from '@/services/api';
import { useAccountFormat } from '@/lib/accountFormat';
import { codeHref, editorHref, presetLabel, themesApi, type ThemeSummary } from '@/lib/themes';
import ThemePreviewPlaceholder from './ThemePreviewPlaceholder';

const card = 'rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800';
const primary =
  'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';
const secondary =
  'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700';

export default function ThemesOverview() {
  const { selectedOrg: org } = useOrg();
  const router = useRouter();
  const { data: session } = useSession();
  const isSystemAdmin = (session?.user as { role?: string } | undefined)?.role === 'SYSTEM_ADMIN';
  const { formatDateTime } = useAccountFormat();
  const [themes, setThemes] = useState<ThemeSummary[] | null>(null);
  const [prefs, setPrefs] = useState<StorefrontPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessSaving, setAccessSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ themes: list }, preferences] = await Promise.all([
        themesApi.list(),
        api.get<StorefrontPreferences>('/admin/online-store/preferences'),
      ]);
      setThemes(list);
      setPrefs(preferences);
    } catch (err: any) {
      setError(err?.message || 'Could not load your themes');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, org?.id]);

  if (!org) return null;
  const storeUrl = `/organizations/${org.slug || org.id}`;
  const live = themes?.find((t) => t.role === 'MAIN') ?? null;
  const drafts = themes?.filter((t) => t.role !== 'MAIN') ?? [];

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
      await load();
    } catch (err: any) {
      setError(err?.message || fallback);
    }
  };
  const rename = (theme: ThemeSummary) => {
    const name = window.prompt('Theme name', theme.name)?.trim();
    if (!name || name === theme.name) return;
    void run(() => themesApi.rename(theme.id, name, theme.version), 'Could not rename the theme');
  };
  const preview = async (theme: ThemeSummary) => {
    // Open the tab inside the click so pop-up blockers allow it, then point it at the link.
    const tab = window.open('', '_blank');
    try {
      const { url } = await themesApi.previewLink(theme.id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err: any) {
      tab?.close();
      setError(err?.message || 'Could not open the preview');
    }
  };
  const sharePreview = async (theme: ThemeSummary) => {
    setError(null);
    try {
      const { url, expiresAt } = await themesApi.previewLink(theme.id, true);
      await navigator.clipboard?.writeText(url).catch(() => {});
      setNotice(`Preview link for ${theme.name} copied (expires ${formatDateTime(expiresAt, { month: 'short', day: 'numeric' })}): ${url}`);
    } catch (err: any) {
      setError(err?.message || 'Could not create a preview link');
    }
  };
  const themeActions = (theme: ThemeSummary) => [
    ...(theme.role === 'MAIN'
      ? [{ label: 'View', href: storeUrl, external: true }]
      : [
          { label: 'Preview', onSelect: () => void preview(theme) },
          { label: 'Share preview', onSelect: () => void sharePreview(theme) },
        ]),
    { label: 'Edit code', href: codeHref(theme.id) },
    { label: 'Rename', onSelect: () => rename(theme) },
    { label: 'Duplicate', onSelect: () => void run(() => themesApi.duplicate(theme.id), 'Could not duplicate the theme') },
    ...(theme.role === 'MAIN'
      ? []
      : [
          {
            label: 'Delete',
            danger: true,
            onSelect: () => {
              if (window.confirm(`Delete ${theme.name}? This cannot be undone.`))
                void run(() => themesApi.remove(theme.id), 'Could not delete the theme');
            },
          },
        ]),
  ];
  const publish = (theme: ThemeSummary) => {
    if (!window.confirm(`Publish ${theme.name}? It replaces ${live?.name ?? 'the live theme'} on your store at once.`)) return;
    void run(() => themesApi.publish(theme.id), 'Could not publish the theme');
  };

  const changeAccess = async (value: string) => {
    if (!prefs) return;
    const makePrivate = value === 'private';
    if (makePrivate && !prefs.hasPassword) {
      router.push('/admin/online-store/preferences#store-access');
      return;
    }
    setAccessSaving(true);
    setError(null);
    try {
      setPrefs(await api.patch<StorefrontPreferences>('/admin/online-store/preferences', { storefrontPrivate: makePrivate }));
    } catch (err: any) {
      setError(err?.status === 403 ? 'Only administrators can change store access.' : err?.message || 'Could not change store access');
    } finally {
      setAccessSaving(false);
    }
  };

  const headerMenu = [
    { label: 'Preferences', href: '/admin/online-store/preferences' },
    { label: 'Pages', href: '/admin/online-store/pages' },
    { label: 'Menus', href: '/admin/content/menus' },
    { label: 'Domains', href: '/admin/settings/domains' },
    ...(isSystemAdmin
      ? [
          {
            label: 'Turn off themes',
            danger: true,
            onSelect: async () => {
              await themesApi.setRollout(false);
              window.location.reload();
            },
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Online Store</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="store-access">
            Store access
          </label>
          <select
            id="store-access"
            value={prefs?.storefrontPrivate ? 'private' : 'public'}
            onChange={(e) => void changeAccess(e.target.value)}
            disabled={!prefs || accessSaving}
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm font-medium text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="public">Public</option>
            <option value="private">Password protected</option>
          </select>
          <a href={storeUrl} target="_blank" rel="noreferrer" className={secondary}>
            View store
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <ActionsMenu label="More online store actions" items={headerMenu} />
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="mb-4 break-all rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {notice}
        </p>
      )}

      {!themes ? (
        <div className={`${card} h-72 animate-pulse`} aria-busy="true" aria-label="Loading themes" />
      ) : live ? (
        <article aria-labelledby="live-theme-name" className={card} data-testid="live-theme">
          <div className="grid gap-4 border-b border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900/40 sm:grid-cols-[1fr_auto]">
            <ThemePreviewPlaceholder brandColor={org.brandColor ?? null} name={org.name} variant="desktop" />
            <ThemePreviewPlaceholder brandColor={org.brandColor ?? null} name={org.name} variant="mobile" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="live-theme-name" className="truncate text-lg font-semibold text-gray-900 dark:text-white">
                  {live.name}
                </h2>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
                  Active
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                Last saved: {formatDateTime(live.lastSavedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {live.lastSavedBy ? ` by ${live.lastSavedBy.name ?? 'a former member'}` : ''} · {presetLabel(live)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ActionsMenu label={`More actions for ${live.name}`} items={themeActions(live)} />
              <Link href={editorHref(live.id)} className={primary}>
                Edit theme
              </Link>
            </div>
          </div>
        </article>
      ) : null}

      {themes && (
        <section aria-labelledby="draft-themes" className={`${card} mt-6`}>
          <h2 id="draft-themes" className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900 dark:border-slate-700 dark:text-white">
            Draft themes
          </h2>
          {drafts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-600 dark:text-slate-400">
              Duplicate your live theme to try changes without touching your store.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-slate-700" data-testid="draft-themes">
              {drafts.map((theme) => (
                <li key={theme.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900 dark:text-white">{theme.name}</p>
                    <p className="text-sm text-gray-600 dark:text-slate-400">
                      Last saved: {formatDateTime(theme.lastSavedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {theme.lastSavedBy ? ` by ${theme.lastSavedBy.name ?? 'a former member'}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ActionsMenu label={`More actions for ${theme.name}`} items={themeActions(theme)} />
                    <button type="button" onClick={() => publish(theme)} className={secondary}>
                      Publish
                    </button>
                    <Link href={editorHref(theme.id)} className={primary}>
                      Edit theme
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="mt-6 text-sm text-gray-500 dark:text-slate-400">
        Changes you save on the live theme show on your store at once; draft themes stay private until you publish them.{' '}
        <Link href="/admin/online-store/preferences" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Brand and store preferences
        </Link>
      </p>
    </div>
  );
}
