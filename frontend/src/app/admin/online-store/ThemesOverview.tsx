'use client';

// Online Store page for organizations in the themes rollout (spec 038 §10,
// card 038J1): store access, View store, and the live theme card with Edit
// theme. Draft themes, previews and import arrive with 038J2 / 038K / 038N.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import ActionsMenu from '@/components/ActionsMenu';
import { useOrg } from '@/components/OrgContext';
import api, { type StorefrontPreferences } from '@/services/api';
import { useAccountFormat } from '@/lib/accountFormat';
import { editorHref, presetLabel, themesApi, type ThemeSummary } from '@/lib/themes';
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
              <ActionsMenu
                label={`More actions for ${live.name}`}
                items={[{ label: 'View', href: storeUrl, external: true }]}
              />
              <Link href={editorHref(live.id)} className={primary}>
                Edit theme
              </Link>
            </div>
          </div>
        </article>
      ) : null}

      <p className="mt-6 text-sm text-gray-500 dark:text-slate-400">
        Changes you save in the theme editor are live on your store at once.{' '}
        <Link href="/admin/online-store/preferences" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Brand and store preferences
        </Link>
      </p>
    </div>
  );
}
