'use client';

// Public main + footer menus for a storefront page. Fetched once per
// organization per page load (module cache) so header and footer share it.

import { useEffect, useState } from 'react';
import api from '@/services/api';
import type { PublicMenus } from '@/lib/menus';

const EMPTY: PublicMenus = { main: [], footer: [] };
const cache = new Map<string, Promise<PublicMenus>>();

export function useStorefrontMenus(orgId: string | null | undefined): PublicMenus | null {
  const [menus, setMenus] = useState<PublicMenus | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    let pending = cache.get(orgId);
    if (!pending) {
      pending = api
        .get<PublicMenus>(`/organizations/${encodeURIComponent(orgId)}/public/menus`)
        .catch(() => EMPTY);
      cache.set(orgId, pending);
      // Keep it fresh: drop the entry after a minute so navigation picks up edits.
      setTimeout(() => cache.delete(orgId), 60_000);
    }
    pending.then((result) => {
      if (!cancelled) setMenus(result);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return menus;
}
