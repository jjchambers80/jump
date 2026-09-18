'use client';

// Organization settings editor: name, public theme mode, and branding (logo,
// cover image, brand color). Shared by the admin organization page
// (/admin/organization/[orgSlug]) and the legacy Organizations list.

import React, { useEffect, useState } from 'react';
import api from '@/services/api';
import ImageUploader from '@/components/ImageUploader';
import BrandColorPicker from '@/components/BrandColorPicker';
import ThemeModePicker from '@/components/ThemeModePicker';
import { resolveAssetUrl } from '@/lib/assets';
import { evaluateBrandColor } from '@/lib/color';
import { DEFAULT_THEME_MODE, type ThemeMode } from '@/lib/theme';

export interface OrganizationSettingsOrg {
  id: string;
  name: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
  themeMode?: ThemeMode;
  createdAt: string;
}

interface OrganizationSettingsProps {
  org: OrganizationSettingsOrg;
  /** Re-fetch the organization after a successful save. */
  onSaved: () => Promise<void> | void;
  /** Surface an error to the parent (parent owns the error banner). */
  onError: (message: string | null) => void;
}

export default function OrganizationSettings({ org, onSaved, onError }: OrganizationSettingsProps) {
  const [editName, setEditName] = useState(org.name);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [editBrandColor, setEditBrandColor] = useState<string | null>(org.brandColor ?? null);
  const [savingBrandColor, setSavingBrandColor] = useState(false);
  const [editThemeMode, setEditThemeMode] = useState<ThemeMode>(org.themeMode ?? DEFAULT_THEME_MODE);
  const [savingThemeMode, setSavingThemeMode] = useState(false);

  // Reset drafts when switching to a different organization.
  useEffect(() => {
    setEditName(org.name);
    setEditBrandColor(org.brandColor ?? null);
    setEditThemeMode(org.themeMode ?? DEFAULT_THEME_MODE);
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
      onError(err.message || 'Failed to update organization');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveThemeMode = async () => {
    try {
      setSavingThemeMode(true);
      onError(null);
      await api.patch(`/organizations/${org.id}`, { themeMode: editThemeMode });
      await onSaved();
    } catch (err: any) {
      onError(err.message || 'Failed to update theme mode');
    } finally {
      setSavingThemeMode(false);
    }
  };

  const handleSaveBrandColor = async () => {
    try {
      setSavingBrandColor(true);
      onError(null);
      await api.patch(`/organizations/${org.id}`, { brandColor: editBrandColor });
      await onSaved();
    } catch (err: any) {
      onError(err.message || 'Failed to update brand color');
    } finally {
      setSavingBrandColor(false);
    }
  };

  const handleImageUpload = async (type: 'logo' | 'cover', file: File) => {
    try {
      setUploading(type);
      onError(null);
      const formData = new FormData();
      formData.append('logo', file);
      await api.upload(`/organizations/${org.id}/${type}`, formData);
      await onSaved();
    } catch (err: any) {
      onError(err.message || `Failed to upload ${type}`);
    } finally {
      setUploading(null);
    }
  };

  const handleImageRemove = async (type: 'logo' | 'cover') => {
    try {
      setUploading(type);
      onError(null);
      await api.delete(`/organizations/${org.id}/${type}`);
      await onSaved();
    } catch (err: any) {
      onError(err.message || `Failed to remove ${type}`);
    } finally {
      setUploading(null);
    }
  };

  const brandColorDirty = editBrandColor !== (org.brandColor ?? null);
  const brandColorPasses = editBrandColor ? evaluateBrandColor(editBrandColor).passesAA : true;

  return (
    <div>
      {/* Name edit */}
      <form onSubmit={handleSaveName} className="flex items-center gap-2 mb-6">
        <label
          htmlFor={`org-name-${org.id}`}
          className="text-sm font-medium text-gray-600 dark:text-slate-400 flex-shrink-0"
        >
          Name
        </label>
        <input
          id={`org-name-${org.id}`}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="flex-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={saving || !editName.trim()}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>

      {/* Theme */}
      <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">Theme</h4>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
        Controls light or dark mode on your public event, venue, and organization pages.
      </p>
      <ThemeModePicker value={editThemeMode} onChange={setEditThemeMode} />
      <div className="mt-3 mb-6">
        <button
          type="button"
          onClick={handleSaveThemeMode}
          disabled={savingThemeMode || editThemeMode === (org.themeMode ?? DEFAULT_THEME_MODE)}
          data-testid="theme-mode-save"
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          {savingThemeMode ? 'Saving…' : 'Save theme'}
        </button>
      </div>

      {/* Branding */}
      <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">Branding</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">
            Logo
          </label>
          <ImageUploader
            currentPreview={resolveAssetUrl(org.logoUrl)}
            onFileSelect={(file) => handleImageUpload('logo', file)}
            onRemove={() => handleImageRemove('logo')}
            uploading={uploading === 'logo'}
            label="logo"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">
            Cover Image
          </label>
          <ImageUploader
            currentPreview={resolveAssetUrl(org.coverUrl)}
            onFileSelect={(file) => handleImageUpload('cover', file)}
            onRemove={() => handleImageRemove('cover')}
            uploading={uploading === 'cover'}
            label="cover image"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">
            Brand color
          </label>
          <BrandColorPicker value={editBrandColor} onChange={setEditBrandColor} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveBrandColor}
              disabled={savingBrandColor || !brandColorDirty}
              data-testid="brand-color-save"
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
            >
              {savingBrandColor ? 'Saving…' : 'Save brand color'}
            </button>
            {!brandColorPasses && (
              <span className="text-xs text-red-600 dark:text-red-400" data-testid="brand-color-warning">
                You can save this color, but it may not meet ADA requirements.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-400 dark:text-slate-500">
        Created {new Date(org.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}
