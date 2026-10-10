'use client';

// Online store settings editor for one organization: store name and handle
// (slug), on the legacy /admin/online-store page. Branding (logos, colors,
// theme mode) lives in Settings › Brand (spec 049); BrandSettingsLink points there.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import api from '@/services/api';

export interface OnlineStoreSettingsOrg {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

interface OnlineStoreSettingsProps {
  org: OnlineStoreSettingsOrg;
  /** Re-fetch the organization after a successful save. */
  onSaved: () => Promise<void> | void;
  /** Surface an error to the parent (parent owns the error banner). */
  onError: (message: string | null) => void;
}

export default function OnlineStoreSettings({ org, onSaved, onError }: OnlineStoreSettingsProps) {
  const [editName, setEditName] = useState(org.name);
  const [saving, setSaving] = useState(false);
  const [editSlug, setEditSlug] = useState(org.slug ?? '');
  const [savingSlug, setSavingSlug] = useState(false);

  // Reset drafts when switching to a different organization.
  useEffect(() => {
    setEditName(org.name);
    setEditSlug(org.slug ?? '');
  }, [org.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    try {
      setSaving(true);
      onError(null);
      await api.patch(`/organizations/${org.id}`, { name: editName.trim() });
      await onSaved();
    } catch (err: any) {
      onError(err.message || 'Failed to update store name');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = editSlug.trim().toLowerCase();
    if (!slug || slug === org.slug) return;
    try {
      setSavingSlug(true);
      onError(null);
      await api.patch(`/organizations/${org.id}`, { slug });
      await onSaved();
    } catch (err: any) {
      onError(err.message || 'Failed to update store handle');
    } finally {
      setSavingSlug(false);
    }
  };

  return (
    <div>
      {/* Name edit */}
      <form onSubmit={handleSaveName} className="flex items-center gap-2 mb-6">
        <label
          htmlFor={`org-name-${org.id}`}
          className="text-sm font-medium text-gray-600 dark:text-slate-400 flex-shrink-0"
        >
          Store name
        </label>
        <input
          id={`org-name-${org.id}`}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        />
        <button
          type="submit"
          disabled={saving || !editName.trim()}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>

      {/* Slug edit */}
      <form onSubmit={handleSaveSlug} className="flex items-center gap-2 mb-1">
        <label
          htmlFor={`org-slug-${org.id}`}
          className="text-sm font-medium text-gray-600 dark:text-slate-400 flex-shrink-0"
        >
          Handle
        </label>
        <input
          id={`org-slug-${org.id}`}
          type="text"
          value={editSlug}
          onChange={(e) => setEditSlug(e.target.value.toLowerCase())}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={60}
          spellCheck={false}
          className="flex-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm font-mono text-gray-900 dark:text-slate-100 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        />
        <button
          type="submit"
          disabled={savingSlug || !editSlug.trim() || editSlug.trim().toLowerCase() === org.slug}
          data-testid="handle-save"
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          {savingSlug ? 'Saving…' : 'Save'}
        </button>
      </form>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-6">
        Short URL-safe name for this store: lowercase letters, digits, and hyphens.
      </p>

      <BrandSettingsLink />

      <div className="mt-4 text-xs text-gray-400 dark:text-slate-500">
        Created {new Date(org.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

/** Short row pointing to Settings › Brand, where branding moved in spec 049. */
export function BrandSettingsLink() {
  return (
    <Link
      href="/admin/settings/brand"
      data-testid="brand-settings-link"
      className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-700 dark:hover:bg-slate-700/40"
    >
      <span>
        <span className="block font-medium text-gray-900 dark:text-white">Brand</span>
        <span className="block text-gray-600 dark:text-slate-400">
          Logos, colors, theme mode and social links are in Settings › Brand.
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden="true" />
    </Link>
  );
}
