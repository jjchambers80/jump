'use client';

// Venues dashboard page — organizer/admin per FR-039
// Lists venues scoped to selected organization, with create/edit forms

import React, { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import OrganizationSelector, { type Organization } from '@/components/OrganizationSelector';

interface Venue {
  id: string;
  name: string;
  address: string;
  timezone: string;
  isPublic: boolean;
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
  timezone: string;
  isPublic: boolean;
}

const EMPTY_FORM: VenueFormData = {
  name: '',
  address: '',
  timezone: 'America/New_York',
  isPublic: true,
};

export default function VenuesPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<VenueFormData>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch organizations on mount
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const data = await api.get<Organization[]>('/organizations');
        setOrganizations(data);
        if (data.length > 0) {
          setSelectedOrgId(data[0].id);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load organizations');
      } finally {
        setLoading(false);
      }
    };
    fetchOrgs();
  }, []);

  // Fetch venues when org changes
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

  const handleOrgSelect = (orgId: string) => {
    setSelectedOrgId(orgId);
    setShowForm(false);
    setEditingId(null);
  };

  const handleCreate = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (venue: Venue) => {
    setFormData({
      name: venue.name,
      address: venue.address,
      timezone: venue.timezone,
      isPublic: venue.isPublic,
    });
    setEditingId(venue.id);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData(EMPTY_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId) return;

    try {
      setSaving(true);
      setError(null);

      if (editingId) {
        await api.patch(`/organizations/${selectedOrgId}/venues/${editingId}`, formData);
      } else {
        await api.post(`/organizations/${selectedOrgId}/venues`, formData);
      }

      setShowForm(false);
      setEditingId(null);
      setFormData(EMPTY_FORM);
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

      {/* Org Selector */}
      <div className="mb-6">
        <OrganizationSelector
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          onSelect={handleOrgSelect}
          loading={loading}
        />
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
              Address *
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Full venue address"
              className="block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
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
              Publicly listed
            </label>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
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
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    {venue.name}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{venue.address}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 dark:text-slate-500">
                    <span>🕐 {venue.timezone}</span>
                    <span>{venue.isPublic ? '🌐 Public' : '🔒 Private'}</span>
                    {venue._count && (
                      <span>
                        📅 {venue._count.events} event{venue._count.events !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
