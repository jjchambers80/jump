'use client';

// Loads the organization's galleries for Insert gallery. A component, not a
// hook in the editor, so editors that never offer galleries never need the
// admin OrgProvider that useGalleriesApi reads.

import { useEffect } from 'react';
import { useGalleriesApi } from '@/app/admin/content/galleries/useGalleriesApi';
import type { GallerySummary } from '@/lib/galleries';

export default function GalleryListLoader({ onLoad }: { onLoad: (galleries: GallerySummary[]) => void }) {
  const galleriesApi = useGalleriesApi();
  useEffect(() => {
    let live = true;
    galleriesApi
      .list()
      .then(({ galleries }) => live && onLoad(galleries))
      .catch(() => live && onLoad([]));
    return () => {
      live = false;
    };
    // onLoad is a fresh closure each render; load once per organization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleriesApi]);
  return null;
}
