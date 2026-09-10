'use client';

// Ticket Presets page — admin area
// Org-scoped reusable ticket type definitions
// Single-page CRUD matching venues page pattern

import React, { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import { useOrg } from '@/components/OrgContext';

interface TierPreset {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  price: number;
  displayOrder: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PresetFormData {
  name: string;
  description: string;
  price: string;
  minPerOrder: string;
  maxPerOrder: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
}

const EMPTY_FORM: PresetFormData = {
  name: '',
  description: '',
  price: '',
  minPerOrder: '1',
  maxPerOrder: '10',
  visibility: 'PUBLIC',
  isRefundable: false,
};

const inputClass =
  'block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

export default function TicketPresetsPage() {
  const { selectedOrgId } = useOrg();
  const [presets, setPresets] = useState<TierPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<PresetFormData>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchPresets = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<{ tierPresets: TierPreset[] }>(
        `/organizations/${selectedOrgId}/tier-presets`
      );
      setPresets(data.tierPresets);
    } catch (err: any) {
      setError(err.message || 'Failed to load ticket presets');
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  useEffect(() => {
    setShowForm(false);
    setEditingId(null);
  }, [selectedOrgId]);

  const handleCreate = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (preset: TierPreset) => {
    setFormData({
      name: preset.name,
      description: preset.description || '',
      price: String(preset.price),
      minPerOrder: preset.minPerOrder ? String(preset.minPerOrder) : '1',
      maxPerOrder: preset.maxPerOrder ? String(preset.maxPerOrder) : '10',
      visibility: preset.visibility,
      isRefundable: preset.isRefundable,
    });
    setEditingId(preset.id);
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

      const payload = {
        name: formData.name,
        description: formData.description || null,
        price: parseFloat(formData.price),
        minPerOrder: formData.minPerOrder ? parseInt(formData.minPerOrder) : null,
        maxPerOrder: formData.maxPerOrder ? parseInt(formData.maxPerOrder) : null,
        visibility: formData.visibility,
        isRefundable: formData.isRefundable,
      };

      if (editingId) {
        await api.patch(`/organizations/${selectedOrgId}/tier-presets/${editingId}`, payload);
      } else {
        await api.post(`/organizations/${selectedOrgId}/tier-presets`, payload);
      }

      setShowForm(false);
      setEditingId(null);
      setFormData(EMPTY_FORM);
      await fetchPresets();
    } catch (err: any) {
      setError(err.message || 'Failed to save ticket preset');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (presetId: string) => {
    if (!selectedOrgId || !confirm('Delete this ticket preset?')) return;

    try {
      setError(null);
      await api.delete(`/organizations/${selectedOrgId}/tier-presets/${presetId}`);
      await fetchPresets();
    } catch (err: any) {
      setError(err.message || 'Failed to delete ticket preset');
    }
  };

  const formatPrice = (price: number) => {
    return price === 0 ? 'Free' : `$${price.toFixed(2)}`;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tickets</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Reusable ticket type presets. Add these to events to quickly set up pricing tiers.
          </p>
        </div>
        {selectedOrgId && !showForm && (
          <button
            onClick={handleCreate}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            New Preset
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-8 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {editingId ? 'Edit Preset' : 'New Preset'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. General Admission"
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Price *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder="0.00"
                className={inputClass}
                required
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description shown to customers"
              rows={2}
              maxLength={500}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>Min per Order</label>
              <input
                type="number"
                min="1"
                value={formData.minPerOrder}
                onChange={(e) => setFormData({ ...formData, minPerOrder: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Max per Order</label>
              <input
                type="number"
                min="1"
                value={formData.maxPerOrder}
                onChange={(e) => setFormData({ ...formData, maxPerOrder: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Visibility</label>
              <select
                value={formData.visibility}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    visibility: e.target.value as 'PUBLIC' | 'PRIVATE' | 'HIDDEN',
                  })
                }
                className={inputClass}
              >
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
                <option value="HIDDEN">Hidden</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={formData.isRefundable}
                  onChange={(e) => setFormData({ ...formData, isRefundable: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Refundable
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
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

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-16 bg-gray-200 dark:bg-slate-700 rounded-lg" />
          ))}
        </div>
      )}

      {!loading && selectedOrgId && presets.length === 0 && (
        <p className="text-gray-500 dark:text-slate-400 text-center py-8">
          No ticket presets yet. Create one to quickly add ticket types to your events.
        </p>
      )}

      {!loading && presets.length > 0 && (
        <div className="space-y-3">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                      {preset.name}
                    </h3>
                    <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                      {formatPrice(preset.price)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-slate-500">
                    {preset.description && (
                      <span className="text-gray-500 dark:text-slate-400">
                        {preset.description}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-slate-500">
                    <span>
                      {preset.visibility === 'PUBLIC'
                        ? 'Public'
                        : preset.visibility === 'PRIVATE'
                          ? 'Private'
                          : 'Hidden'}
                    </span>
                    {preset.isRefundable && <span>Refundable</span>}
                    <span>
                      {preset.minPerOrder ?? 1}-{preset.maxPerOrder ?? 10} per order
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleEdit(preset)}
                    className="rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(preset.id)}
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
