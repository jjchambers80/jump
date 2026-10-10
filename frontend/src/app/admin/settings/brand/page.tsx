'use client';

// Settings › General › Brand (spec 049) — /admin/settings/brand
// The organization's brand identity: logos, colors, theme mode, slogan,
// short description and social links. Emails and non-theme pages use it
// directly; a theme's own settings override it and empty theme values inherit
// it. Each card saves only its own fields (partial PATCH /organizations/:id).

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';
import SettingsNav from '../SettingsNav';
import { ColorsCard, LogosCard, SocialLinksCard, TextCard, cardClass, type BrandOrg } from './BrandSections';

export default function BrandSettingsPage() {
  const { selectedOrgId, loading: orgLoading, refresh } = useOrg();
  const [org, setOrg] = useState<BrandOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (orgId: string | null) => {
    if (!orgId) {
      setOrg(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setOrg(await api.get<BrandOrg>(`/organizations/${orgId}`));
    } catch (err: any) {
      setError(err.message || 'Unable to load brand settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch once the switcher resolves and again when the selection changes,
  // not when it merely refreshes its list after a save here.
  const loadedForOrg = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (orgLoading && !selectedOrgId) return;
    if (loadedForOrg.current === selectedOrgId) return;
    loadedForOrg.current = selectedOrgId;
    void load(selectedOrgId);
  }, [orgLoading, selectedOrgId, load]);

  const onSaved = (next: BrandOrg) => {
    setOrg(next);
    // The switcher and sidebar show the logo and brand color.
    void refresh();
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Manage your organization and business information.</p>

      <div className="mt-8 flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav />

        <section aria-labelledby="brand-settings-heading" className="min-w-0 flex-1">
          <Link
            href="/admin/settings"
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            General
          </Link>
          <h2 id="brand-settings-heading" className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
            Brand
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            Your store&apos;s identity. Emails and store pages use it, and your theme starts from it.
          </p>

          {loading && (
            <div aria-label="Loading brand settings" className="mt-4 space-y-4">
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
              <h3 className="font-semibold text-red-800 dark:text-red-300">Brand settings could not be loaded</h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => load(selectedOrgId)}
                className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && !org && (
            <p className="mt-4 text-sm text-gray-500 dark:text-slate-400">Pick an organization from the menu in the top right.</p>
          )}

          {!loading && org && (
            <div className="mt-4 space-y-4">
              <LogosCard key={`logos-${org.id}`} org={org} onSaved={onSaved} />
              <ColorsCard key={`colors-${org.id}`} org={org} onSaved={onSaved} />
              <TextCard key={`text-${org.id}`} org={org} onSaved={onSaved} />
              <SocialLinksCard key={`social-${org.id}`} org={org} onSaved={onSaved} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
