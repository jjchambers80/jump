'use client';

// Content › Galleries — /admin/content/galleries (spec 046)

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Images } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import SettingsDialog from '@/app/admin/settings/SettingsDialog';
import ToastHost from '@/components/content/Toast';
import { resolveAssetUrl } from '@/lib/assets';
import type { GallerySummary } from '@/lib/galleries';
import { useGalleriesApi } from './useGalleriesApi';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export default function GalleriesPage() {
  const router = useRouter();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const galleriesApi = useGalleriesApi();
  const [galleries, setGalleries] = useState<GallerySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setGalleries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setGalleries((await galleriesApi.list()).galleries);
    } catch (err: any) {
      setError(err?.message || 'Failed to load galleries');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, galleriesApi]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const openCreate = () => {
    setTitle('');
    setDialogError(null);
    setCreateOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setDialogError(null);
    try {
      const created = await galleriesApi.create(title.trim());
      router.push(`/admin/content/galleries/${created.id}`);
    } catch (err: any) {
      setDialogError(err?.message || 'Could not create the gallery');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ToastHost />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-300">Content</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Galleries</h1>
        </div>
        <button
          ref={createRef}
          type="button"
          onClick={openCreate}
          disabled={!selectedOrgId}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          New gallery
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 font-semibold underline">
            Try again
          </button>
        </div>
      )}

      {!orgLoading && !selectedOrgId && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">
          Pick an organization from the menu in the top right.
        </p>
      )}

      {selectedOrgId && loading && (
        <div aria-label="Loading galleries" className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          ))}
        </div>
      )}

      {selectedOrgId && !loading && !error && galleries.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-slate-600">
          <Images className="mx-auto h-10 w-10 text-gray-400" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-gray-900 dark:text-white">No galleries yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-600 dark:text-slate-300">
            Group photos from Files into sections, then place the gallery on any page.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            New gallery
          </button>
        </div>
      )}

      {selectedOrgId && !loading && galleries.length > 0 && (
        <ul
          aria-label="Galleries"
          className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800"
        >
          {galleries.map((gallery) => (
            <li key={gallery.id} data-testid="gallery-row">
              <Link
                href={`/admin/content/galleries/${gallery.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/40 dark:focus-visible:bg-slate-700/40"
              >
                {gallery.coverThumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveAssetUrl(gallery.coverThumbUrl) || undefined}
                    alt=""
                    className="h-14 w-14 flex-none rounded-md object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 flex-none items-center justify-center rounded-md bg-gray-100 dark:bg-slate-700">
                    <Images className="h-6 w-6 text-gray-400" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1 md:grid md:grid-cols-3 md:items-center md:gap-4">
                  <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {gallery.title}
                  </span>
                  <span className="block text-sm text-gray-600 dark:text-slate-300">
                    {plural(gallery.photoCount, 'photo')}
                    {gallery.sectionCount > 1 && ` · ${plural(gallery.sectionCount, 'section')}`}
                  </span>
                  <span className="block text-sm text-gray-500 dark:text-slate-400">
                    {gallery.placementCount
                      ? `Used in ${plural(gallery.placementCount, 'place')}`
                      : 'Not placed yet'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {createOpen && (
        <SettingsDialog
          titleId="create-gallery-title"
          title="New gallery"
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
          <label htmlFor="gallery-title" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
            Title
          </label>
          <input
            ref={titleRef}
            id="gallery-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={100}
            placeholder="e.g. Retro Expo 2026"
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
