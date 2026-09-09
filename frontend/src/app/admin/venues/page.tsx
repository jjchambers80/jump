'use client';

// Venues page — admin area (T009)
// Moved from dashboard/venues/page.tsx
// AdminRoute guard provided by admin layout.tsx

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import api from '@/services/api';
import { resolveAssetUrl } from '@/lib/assets';
import { StateSelect } from '@/components/StateSelect';
import { useOrg } from '@/components/OrgContext';
import ImageUploader from '@/components/ImageUploader';

interface Venue {
  id: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timezone: string;
  isPublic: boolean;
  logoUrl: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    events: number;
  };
}

interface VenueFormData {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  timezone: string;
  isPublic: boolean;
}

const EMPTY_FORM: VenueFormData = {
  name: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  timezone: 'America/New_York',
  isPublic: true,
};

export default function VenuesPage() {
  const { selectedOrgId } = useOrg();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<VenueFormData>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const fetchVenues = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setVenuesLoading(true);
      setError(null);
      const data = await api.get<Venue[]>(`/organizations/${selectedOrgId}/venues`);
      setVenues(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load venues');
    } finally {
      setVenuesLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  // Reset form when org changes
  useEffect(() => {
    setShowForm(false);
    setEditingId(null);
  }, [selectedOrgId]);

  const handleCreate = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setSelectedLogo(null);
    setLogoPreview(null);
    setShowForm(true);
  };

  const handleEdit = (venue: Venue) => {
    setFormData({
      name: venue.name,
      address: venue.address,
      city: venue.city || '',
      state: venue.state || '',
      postalCode: venue.postalCode || '',
      timezone: venue.timezone,
      isPublic: venue.isPublic,
    });
    setEditingId(venue.id);
    setSelectedLogo(null);
    setLogoPreview(resolveAssetUrl(venue.logoUrl));
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setSelectedLogo(null);
    setLogoPreview(null);
  };

  const handleLogoSelect = (file: File) => {
    setSelectedLogo(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleLogoRemove = async () => {
    if (selectedLogo) {
      setSelectedLogo(null);
      const existingLogoUrl = editingId
        ? resolveAssetUrl(venues.find((venue) => venue.id === editingId)?.logoUrl)
        : null;
      setLogoPreview(existingLogoUrl);
      return;
    }
    if (!selectedOrgId || !editingId) return;

    try {
      setLogoUploading(true);
      setError(null);
      await api.delete(`/organizations/${selectedOrgId}/venues/${editingId}/logo`);
      setLogoPreview(null);
      await fetchVenues();
    } catch (err: any) {
      setError(err.message || 'Failed to remove venue logo');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId) return;

    try {
      setSaving(true);
      setError(null);

      let savedVenue: Venue;
      if (editingId) {
        savedVenue = await api.patch<Venue>(
          `/organizations/${selectedOrgId}/venues/${editingId}`,
          formData
        );
      } else {
        savedVenue = await api.post<Venue>(`/organizations/${selectedOrgId}/venues`, formData);
      }

      if (selectedLogo) {
        try {
          setLogoUploading(true);
          const uploadData = new FormData();
          uploadData.append('logo', selectedLogo);
          await api.upload(`/organizations/${selectedOrgId}/venues/${savedVenue.id}/logo`, uploadData);
        } catch (uploadError: any) {
          setError(
            `Venue saved, but its logo could not be uploaded: ${uploadError.message || 'Upload failed'}`
          );
          await fetchVenues();
          setShowForm(false);
          return;
        } finally {
          setLogoUploading(false);
        }
      }

      setShowForm(false);
      setEditingId(null);
      setFormData(EMPTY_FORM);
      setSelectedLogo(null);
      setLogoPreview(null);
      await fetchVenues();
    } catch (err: any) {
      setError(err.message || 'Failed to save venue');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (venueId: string) => {
    if (!selectedOrgId || !confirm('Are you sure you want to delete this venue?')) return;

    try {
      setError(null);
      await api.delete(`/organizations/${selectedOrgId}/venues/${venueId}`);
      await fetchVenues();
    } catch (err: any) {
      setError(err.message || 'Failed to delete venue');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Venues</h1>
        {selectedOrgId && !showForm && (
          <button
            onClick={handleCreate}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            Add Venue
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-8 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {editingId ? 'Edit Venue' : 'New Venue'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Venue name"
                className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Timezone
              </label>
              <input
                type="text"
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                placeholder="America/New_York"
                className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Street Address *
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="123 Main St"
              className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                City
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="e.g. Raleigh"
                className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <StateSelect
              value={formData.state}
              onChange={(value) => setFormData({ ...formData, state: value })}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Postal Code
              </label>
              <input
                type="text"
                value={formData.postalCode}
                onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                placeholder="e.g. 27601"
                className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPublic"
              checked={formData.isPublic}
              onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="isPublic" className="text-sm text-gray-700 dark:text-slate-300">
              Public venue page enabled. When disabled, the public URL returns not found.
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Venue Logo
            </label>
            <ImageUploader
              currentPreview={logoPreview}
              onFileSelect={handleLogoSelect}
              onRemove={handleLogoRemove}
              uploading={logoUploading}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving || logoUploading ? 'Saving…' : editingId ? 'Update' : 'Create'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {venuesLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-20 bg-gray-200 dark:bg-slate-700 rounded-lg" />
          ))}
        </div>
      )}

      {/* Venue List */}
      {!venuesLoading && selectedOrgId && venues.length === 0 && (
        <p className="text-gray-500 dark:text-slate-400 text-center py-8">
          No venues yet. Click &quot;Add Venue&quot; to create one.
        </p>
      )}

      {!venuesLoading && venues.length > 0 && (
        <div className="space-y-3">
          {venues.map((venue) => (
            <div
              key={venue.id}
              className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  {resolveAssetUrl(venue.logoUrl) ? (
                    <img
                      src={resolveAssetUrl(venue.logoUrl) || undefined}
                      alt={`${venue.name} logo`}
                      className="h-14 w-14 shrink-0 rounded-md border border-gray-200 bg-white object-contain p-1 dark:border-slate-600"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-gray-100 font-bold text-gray-500 dark:bg-slate-700 dark:text-slate-300" aria-hidden="true">
                      {venue.name.trim().charAt(0).toUpperCase() || 'V'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                      {venue.name}
                    </h3>
                    <p className="mt-1 break-words text-sm text-gray-500 dark:text-slate-400">{venue.address}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-slate-500">
                      <span>🕐 {venue.timezone}</span>
                      <span>{venue.isPublic ? '🌐 Public' : '🔒 Private'}</span>
                      {venue._count && (
                        <span>
                          📅 {venue._count.events} event{venue._count.events !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {venue.isPublic && (
                    <Link
                      href={`/venues/${venue.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-indigo-300 dark:border-indigo-700 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                    >
                      View public page
                    </Link>
                  )}
                  <button
                    onClick={() => handleEdit(venue)}
                    className="rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(venue.id)}
                    className="rounded-md border border-red-300 dark:border-red-700 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
