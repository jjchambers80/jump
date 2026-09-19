'use client';

// Content › Menus — /admin/content/menus (spec 027)

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import ToastHost from '@/components/content/Toast';
import type { MenuSummary } from '@/lib/menus';
import { useMenusApi } from './useMenusApi';

const th =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400';
// URL redirects arrive with spec 028; keep the header slot ready.
const URL_REDIRECTS_ENABLED = false;

export default function MenusPage() {
  const router = useRouter();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const menusApi = useMenusApi();
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setMenus([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setMenus((await menusApi.list()).menus);
    } catch (err: any) {
      setError(err?.message || 'Failed to load menus');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, menusApi]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setDialogError(null);
    try {
      const created = await menusApi.create(title.trim());
      router.push(`/admin/content/menus/${created.id}`);
    } catch (err: any) {
      setDialogError(err?.message || 'Could not create the menu');
      setSaving(false);
    }
  };

  const sorted = [...menus].sort((a, b) =>
    sortAsc ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title)
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ToastHost />
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
        data-testid="menus-header"
      >
        <div>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Content</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Menus</h1>
        </div>
        <div className="flex items-center gap-2">
          {URL_REDIRECTS_ENABLED && (
            <Link
              href="/admin/content/menus/redirects"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              URL redirects
            </Link>
          )}
          <button
            ref={createRef}
            type="button"
            onClick={() => {
              setTitle('');
              setDialogError(null);
              setCreateOpen(true);
            }}
            disabled={!selectedOrgId}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            Create menu
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {!orgLoading && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      )}

      {selectedOrgId && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          {loading ? (
            <div aria-label="Loading menus" className="space-y-3 p-4">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700"
                />
              ))}
            </div>
          ) : (
            <table
              aria-label="Menus"
              className="min-w-full divide-y divide-gray-200 dark:divide-slate-700"
            >
              <thead className="bg-gray-50 dark:bg-slate-900/50">
                <tr>
                  <th
                    scope="col"
                    className={`${th} w-1/3`}
                    aria-sort={sortAsc ? 'ascending' : 'descending'}
                  >
                    <button
                      type="button"
                      onClick={() => setSortAsc((v) => !v)}
                      className="inline-flex items-center gap-1 uppercase hover:text-gray-900 dark:hover:text-white"
                    >
                      Menu <span aria-hidden>{sortAsc ? '↑' : '↓'}</span>
                    </button>
                  </th>
                  <th scope="col" className={th}>
                    Menu items
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {sorted.map((menu) => (
                  <tr
                    key={menu.id}
                    data-testid="menu-row"
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40"
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a')) return;
                      router.push(`/admin/content/menus/${menu.id}`);
                    }}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      <Link href={`/admin/content/menus/${menu.id}`} className="hover:underline">
                        {menu.title}
                      </Link>
                    </td>
                    <td className="max-w-xl truncate px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                      {menu.itemLabels.length ? (
                        menu.itemLabels.join(', ')
                      ) : (
                        <span className="text-gray-400 dark:text-slate-500">No items yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {createOpen && (
        <SettingsDialog
          titleId="create-menu-title"
          title="Create menu"
          dirty={title.trim().length > 0}
          saving={saving}
          saveDisabled={!title.trim()}
          submitLabel="Create"
          savingLabel="Creating…"
          initialFocusRef={titleRef}
          returnFocusRef={createRef}
          onClose={() => setCreateOpen(false)}
          onSubmit={submit}
        >
          <label
            htmlFor="menu-title"
            className="block text-sm font-medium text-gray-700 dark:text-slate-300"
          >
            Name
          </label>
          <input
            ref={titleRef}
            id="menu-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={100}
            placeholder="e.g. Sponsors"
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          {dialogError && (
            <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
              {dialogError}
            </p>
          )}
        </SettingsDialog>
      )}
    </div>
  );
}
