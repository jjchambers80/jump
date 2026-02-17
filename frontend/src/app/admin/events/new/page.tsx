'use client';

// Event creation form — admin area (T011)
// Moved from dashboard/events/new/page.tsx
// Links updated from /dashboard/* to /admin/*
// AdminRoute guard provided by admin layout.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import OrganizationSelector, { type Organization } from '@/components/OrganizationSelector';

interface Venue {
  id: string;
  name: string;
  address: string;
}

interface PriceTierInput {
  key: string;
  name: string;
  price: string;
  quantityTotal: string;
  minPerOrder: string;
  maxPerOrder: string;
}

function newTier(): PriceTierInput {
  return {
    key: crypto.randomUUID(),
    name: '',
    price: '',
    quantityTotal: '',
    minPerOrder: '1',
    maxPerOrder: '10',
  };
}

export default function CreateEventPage() {
  const router = useRouter();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [orgsLoading, setOrgsLoading] = useState(true);

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState('');
  const [capacity, setCapacity] = useState('');
  const [category, setCategory] = useState('');
  const [priceTiers, setPriceTiers] = useState<PriceTierInput[]>([newTier()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const data = await api.get<Organization[]>('/organizations');
        setOrganizations(data);
        if (data.length > 0) setSelectedOrgId(data[0].id);
      } catch (err: any) {
        setError(err.message || 'Failed to load organizations');
      } finally {
        setOrgsLoading(false);
      }
    };
    fetchOrgs();
  }, []);

  const fetchVenues = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      setVenuesLoading(true);
      const data = await api.get<Venue[]>(`/organizations/${selectedOrgId}/venues`);
      setVenues(data);
      setVenueId('');
    } catch (err: any) {
      setError(err.message || 'Failed to load venues');
    } finally {
      setVenuesLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  const addTier = () => setPriceTiers([...priceTiers, newTier()]);
  const removeTier = (key: string) => {
    if (priceTiers.length > 1) {
      setPriceTiers(priceTiers.filter((t) => t.key !== key));
    }
  };
  const updateTier = (key: string, field: keyof PriceTierInput, value: string) => {
    setPriceTiers(priceTiers.map((t) => (t.key === key ? { ...t, [field]: value } : t)));
  };
  const moveTier = (index: number, direction: 'up' | 'down') => {
    const newTiers = [...priceTiers];
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= newTiers.length) return;
    [newTiers[index], newTiers[swap]] = [newTiers[swap], newTiers[index]];
    setPriceTiers(newTiers);
  };

  const totalTierQuantity = priceTiers.reduce(
    (sum, t) => sum + (parseInt(t.quantityTotal) || 0),
    0
  );
  const capacityNum = parseInt(capacity) || 0;
  const capacityExceeded = capacityNum > 0 && totalTierQuantity > capacityNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !venueId) return;

    try {
      setSaving(true);
      setError(null);

      const payload = {
        venueId,
        name,
        description: description || undefined,
        date: new Date(date).toISOString(),
        capacity: parseInt(capacity),
        category: category || undefined,
        priceTiers: priceTiers.map((t, i) => ({
          name: t.name,
          price: parseFloat(t.price), // dollars - backend stores as Decimal
          quantityTotal: parseInt(t.quantityTotal),
          displayOrder: i,
          minPerOrder: t.minPerOrder ? parseInt(t.minPerOrder) : undefined,
          maxPerOrder: t.maxPerOrder ? parseInt(t.maxPerOrder) : undefined,
        })),
      };

      await api.post(`/organizations/${selectedOrgId}/events`, payload);
      router.push('/admin/events');
    } catch (err: any) {
      setError(err.message || 'Failed to create event');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create Event</h1>
        <button
          onClick={() => router.push('/admin/events')}
          className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Back to Events
        </button>
      </div>

      {/* Org Selector */}
      <div className="mb-6">
        <OrganizationSelector
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          onSelect={(id) => setSelectedOrgId(id)}
          loading={orgsLoading}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 space-y-6"
      >
        {/* Event Details */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Event Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelClass}>Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Event name"
                className={inputClass}
                required
                maxLength={255}
              />
            </div>

            <div className="md:col-span-2">
              <label className={labelClass}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Event description"
                rows={3}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Venue *</label>
              {venuesLoading ? (
                <div className="animate-pulse h-10 bg-gray-200 dark:bg-slate-700 rounded" />
              ) : venues.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  No venues found.{' '}
                  <a
                    href="/admin/venues"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Create one first
                  </a>
                </p>
              ) : (
                <select
                  value={venueId}
                  onChange={(e) => setVenueId(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Select a venue</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.address}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className={labelClass}>Date & Time *</label>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Capacity *</label>
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="1–100,000"
                min={1}
                max={100000}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Music, Sports, Conference"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Price Tiers */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Price Tiers</h2>
            <button
              type="button"
              onClick={addTier}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              + Add Tier
            </button>
          </div>

          {capacityExceeded && (
            <div className="mb-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3">
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                ⚠ Total tier quantity ({totalTierQuantity}) exceeds event capacity ({capacityNum})
              </p>
            </div>
          )}

          <div className="space-y-4">
            {priceTiers.map((tier, index) => (
              <div
                key={tier.key}
                className="rounded-lg border border-gray-200 dark:border-slate-600 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500 dark:text-slate-400">
                    Tier {index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveTier(index, 'up')}
                      disabled={index === 0}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTier(index, 'down')}
                      disabled={index === priceTiers.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      title="Move down"
                    >
                      ↓
                    </button>
                    {priceTiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTier(tier.key)}
                        className="p-1 text-red-400 hover:text-red-600"
                        title="Remove tier"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className={labelClass}>Tier Name *</label>
                    <input
                      type="text"
                      value={tier.name}
                      onChange={(e) => updateTier(tier.key, 'name', e.target.value)}
                      placeholder="e.g. General Admission"
                      className={inputClass}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Price ($) *</label>
                    <input
                      type="number"
                      value={tier.price}
                      onChange={(e) => updateTier(tier.key, 'price', e.target.value)}
                      placeholder="0.00"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Quantity *</label>
                    <input
                      type="number"
                      value={tier.quantityTotal}
                      onChange={(e) => updateTier(tier.key, 'quantityTotal', e.target.value)}
                      placeholder="100"
                      min={1}
                      className={inputClass}
                      required
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Min / Order</label>
                    <input
                      type="number"
                      value={tier.minPerOrder}
                      onChange={(e) => updateTier(tier.key, 'minPerOrder', e.target.value)}
                      min={1}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Max / Order</label>
                    <input
                      type="number"
                      value={tier.maxPerOrder}
                      onChange={(e) => updateTier(tier.key, 'maxPerOrder', e.target.value)}
                      min={1}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !venueId || capacityExceeded}
            className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Event'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/events')}
            className="rounded-md border border-gray-300 dark:border-slate-600 px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
