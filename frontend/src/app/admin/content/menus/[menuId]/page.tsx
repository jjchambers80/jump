'use client';

// Content › Menus › menu — /admin/content/menus/[menuId] (spec 027)

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/components/OrgContext';
import type { Menu } from '@/lib/menus';
import MenuEditor from '../MenuEditor';
import { useMenusApi } from '../useMenusApi';

export default function MenuPage() {
  const params = useParams<{ menuId: string }>();
  const { selectedOrgId, loading: orgLoading } = useOrg();
  const menusApi = useMenusApi();
  const [menu, setMenu] = useState<Menu | null>(null);
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
      setMenu(await menusApi.get(params.menuId));
    } catch (err: any) {
      setError(
        err?.status === 404 ? 'This menu was not found.' : err?.message || 'Failed to load the menu'
      );
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId, menusApi, params.menuId]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div aria-label="Loading menu" className="space-y-4">
          <div className="h-24 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
          <div className="h-72 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (!selectedOrgId || error || !menu) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link
          href="/admin/content/menus"
          className="text-sm text-gray-600 hover:underline dark:text-slate-300"
        >
          Menus
        </Link>
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          {!selectedOrgId ? 'Pick an organization from the menu in the top right.' : error}
        </div>
      </div>
    );
  }

  return <MenuEditor key={menu.id} menu={menu} onSaved={setMenu} />;
}
