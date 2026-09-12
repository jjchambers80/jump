'use client';

// Organizations page — admin area (T008)
// Moved from dashboard/organizations/page.tsx
// AdminRoute guard provided by admin layout.tsx

import React, { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import ImageUploader from '@/components/ImageUploader';
import { resolveAssetUrl } from '@/lib/assets';

interface Organization {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  logoUrl?: string | null;
  coverUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    venues: number;
    users: number;
  };
}

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const fetchOrganizations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<Organization[]>('/organizations');
      setOrganizations(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      setCreating(true);
      setError(null);
      await api.post('/organizations', { name: newName.trim() });
      setNewName('');
      await fetchOrganizations();
    } catch (err: any) {
      setError(err.message || 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (org: Organization) => {
    setEditingId(org.id);
    setEditName(org.name);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveEdit = async (orgId: string) => {
    if (!editName.trim()) return;
    try {
      setSaving(true);
      setError(null);
      await api.patch(`/organizations/${orgId}`, { name: editName.trim() });
      setEditingId(null);
      setEditName('');
      await fetchOrganizations();
    } catch (err: any) {
      setError(err.message || 'Failed to update organization');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (orgId: string, type: 'logo' | 'cover', file: File) => {
    try {
      setUploading(`${orgId}-${type}`);
      setError(null);
      const formData = new FormData();
      formData.append('logo', file);
      await api.upload(`/organizations/${orgId}/${type}`, formData);
      await fetchOrganizations();
    } catch (err: any) {
      setError(err.message || `Failed to upload ${type}`);
    } finally {
      setUploading(null);
    }
  };

  const handleImageRemove = async (orgId: string, type: 'logo' | 'cover') => {
    try {
      setUploading(`${orgId}-${type}`);
      setError(null);
      await api.delete(`/organizations/${orgId}/${type}`);
      await fetchOrganizations();
    } catch (err: any) {
      setError(err.message || `Failed to remove ${type}`);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Organizations</h1>

      {/* Create Form */}
      <form onSubmit={handleCreate} className="mb-8 flex items-end gap-3">
        <div className="flex-1">
          <label
            htmlFor="org-name"
            className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
          >
            New Organization
          </label>
          <input
            id="org-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Organization name"
            className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            required
          />
        </div>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-16 bg-gray-200 dark:bg-slate-700 rounded-lg" />
          ))}
        </div>
      )}

      {/* Organization List */}
      {!loading && organizations.length === 0 && (
        <p className="text-gray-500 dark:text-slate-400 text-center py-8">
          No organizations yet. Create one above to get started.
        </p>
      )}

      {!loading && organizations.length > 0 && (
        <div className="space-y-3">
          {organizations.map((org) => (
            <div
              key={org.id}
              className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden"
            >
              {/* Header row */}
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Logo thumbnail */}
                  {org.logoUrl ? (
                    <img
                      src={resolveAssetUrl(org.logoUrl) || undefined}
                      alt={`${org.name} logo`}
                      className="w-10 h-10 rounded-md object-contain bg-gray-100 dark:bg-slate-700 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-gray-400 dark:text-slate-500 text-lg font-bold">
                        {org.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                      {org.name}
                    </h3>
                    <div className="flex items-center gap-4 mt-0.5 text-sm text-gray-500 dark:text-slate-400">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          org.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400'
                        }`}
                      >
                        {org.status}
                      </span>
                      {org._count && (
                        <>
                          <span>
                            {org._count.venues} venue{org._count.venues !== 1 ? 's' : ''}
                          </span>
                          <span>
                            {org._count.users} user{org._count.users !== 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="ml-4">
                  {editingId !== org.id ? (
                    <button
                      onClick={() => handleEdit(org)}
                      className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300"
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      onClick={handleCancelEdit}
                      className="text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>

              {/* Edit section — name + branding */}
              {editingId === org.id && (
                <div className="border-t border-gray-200 dark:border-slate-700 p-4 bg-gray-50 dark:bg-slate-800/50">
                  {/* Name edit */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveEdit(org.id);
                    }}
                    className="flex items-center gap-2 mb-6"
                  >
                    <label className="text-sm font-medium text-gray-600 dark:text-slate-400 flex-shrink-0">
                      Name
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={saving || !editName.trim()}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </form>

                  {/* Branding */}
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">
                    Branding
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">
                        Logo
                      </label>
                      <ImageUploader
                        currentPreview={resolveAssetUrl(org.logoUrl)}
                        onFileSelect={(file) => handleImageUpload(org.id, 'logo', file)}
                        onRemove={() => handleImageRemove(org.id, 'logo')}
                        uploading={uploading === `${org.id}-logo`}
                        label="logo"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 dark:text-slate-400 mb-2">
                        Cover Image
                      </label>
                      <ImageUploader
                        currentPreview={resolveAssetUrl(org.coverUrl)}
                        onFileSelect={(file) => handleImageUpload(org.id, 'cover', file)}
                        onRemove={() => handleImageRemove(org.id, 'cover')}
                        uploading={uploading === `${org.id}-cover`}
                        label="cover image"
                      />
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-gray-400 dark:text-slate-500">
                    Created {new Date(org.createdAt).toLocaleDateString()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
