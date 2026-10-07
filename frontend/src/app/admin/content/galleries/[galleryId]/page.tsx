'use client';

// Content › Galleries › gallery — /admin/content/galleries/[galleryId] (spec 046)

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import type { Gallery } from '@/lib/galleries';
import GalleryEditor from '../GalleryEditor';
import { useGalleriesApi } from '../useGalleriesApi';

export default function GalleryPage() {
  const params = useParams<{ galleryId: string }>();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const galleriesApi = useGalleriesApi();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setGallery(await galleriesApi.get(params.galleryId));
    } catch (err: any) {
      setError(err?.status === 404 ? 'This gallery was not found.' : err?.message || 'Failed to load the gallery');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, galleriesApi, params.galleryId]);

  // Load once the org is known, and again only when the selected org changes:
  // the switcher's refresh() toggles `loading`, which must not refetch (and,
  // on the editor, unmount unsaved edits).
  const loadedFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading || loadedFor.current === selectedOrgId) return;
    loadedFor.current = selectedOrgId;
    void load();
  }, [orgLoading, selectedOrgId, load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div aria-label="Loading gallery" className="space-y-4">
          <div className="h-24 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          <div className="h-72 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (!selectedOrgId || error || !gallery) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/admin/content/galleries" className="text-sm text-gray-600 hover:underline dark:text-slate-300">
          Galleries
        </Link>
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <p>{!selectedOrgId ? 'Pick an organization from the menu in the top right.' : error}</p>
          {selectedOrgId && (
            <button type="button" onClick={() => void load()} className="mt-2 font-semibold underline">
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return <GalleryEditor key={gallery.id} gallery={gallery} onSaved={setGallery} />;
}
