'use client';

// Event edit form — admin area
// Loads existing event data and allows updating fields
// Uses PATCH /organizations/:orgId/events/:eventId

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { resolveAssetUrl } from '@/lib/assets';

interface Venue {
  id: string;
  name: string;
  address: string;
}

interface PriceTier {
  id: string;
  name: string;
  description: string | null;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  quantityAvailable: number;
  quantityReserved: number;
  displayOrder: number;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  isActive: boolean;
  saleStartDate: string | null;
  saleEndDate: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  isOnSale: boolean;
  saleStatus: 'NOT_STARTED' | 'ON_SALE' | 'ENDED';
}

interface TierFormInput {
  key: string; // existing tier id or temp UUID for new tiers
  isNew: boolean;
  name: string;
  description: string;
  price: string;
  quantityTotal: string;
  quantitySold: number; // read-only, for existing tiers
  quantityReserved: number; // read-only, for existing tiers
  minPerOrder: string;
  maxPerOrder: string;
  saleStartDate: string;
  saleEndDate: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  isActive: boolean;
}

function tierToForm(t: PriceTier): TierFormInput {
  return {
    key: t.id,
    isNew: false,
    name: t.name,
    description: t.description || '',
    price: String(Number(t.price)),
    quantityTotal: String(t.quantityTotal),
    quantitySold: t.quantitySold,
    quantityReserved: t.quantityReserved ?? 0,
    minPerOrder: t.minPerOrder != null ? String(t.minPerOrder) : '',
    maxPerOrder: t.maxPerOrder != null ? String(t.maxPerOrder) : '',
    saleStartDate: t.saleStartDate ? toDatetimeLocal(t.saleStartDate) : '',
    saleEndDate: t.saleEndDate ? toDatetimeLocal(t.saleEndDate) : '',
    visibility: t.visibility,
    isRefundable: t.isRefundable,
    isActive: t.isActive,
  };
}

function newTierForm(): TierFormInput {
  return {
    key: crypto.randomUUID(),
    isNew: true,
    name: '',
    description: '',
    price: '',
    quantityTotal: '',
    quantitySold: 0,
    quantityReserved: 0,
    minPerOrder: '1',
    maxPerOrder: '10',
    saleStartDate: '',
    saleEndDate: '',
    visibility: 'PUBLIC',
    isRefundable: false,
    isActive: true,
  };
}

interface EventDetail {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  date: string;
  capacity: number;
  category: string | null;
  status: string;
  venue: {
    id: string;
    name: string;
    address: string;
  } | null;
  priceTiers: PriceTier[];
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


export default function EditEventPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.eventId as string;
  const orgId = searchParams.get('orgId');

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [eventData, setEventData] = useState<EventDetail | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(true);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState('');
  const [capacity, setCapacity] = useState('');
  const [category, setCategory] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [priceTiers, setPriceTiers] = useState<TierFormInput[]>([]);
  const [tiersInitialized, setTiersInitialized] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load event data
  useEffect(() => {
    if (!orgId || !eventId) return;
    const fetchEvent = async () => {
      try {
        setLoadingEvent(true);
        const data = await api.get<{ events: EventDetail[] }>(
          `/organizations/${orgId}/events?limit=100`
        );
        const event = data.events.find((e) => e.id === eventId);
        if (!event) {
          setError('Event not found');
          return;
        }
        setEventData(event);
        setName(event.name);
        setDescription(event.description || '');
        setVenueId(event.venue?.id || '');
        setDate(toDatetimeLocal(event.date));
        setCapacity(String(event.capacity));
        setCategory(event.category || '');
        setLogoUrl(event.logoUrl || null);
        // Initialize tier form state from loaded tiers
        const sorted = [...event.priceTiers].sort((a, b) => a.displayOrder - b.displayOrder);
        setPriceTiers(sorted.map(tierToForm));
        setTiersInitialized(true);
      } catch (err: any) {
        setError(err.message || 'Failed to load event');
      } finally {
        setLoadingEvent(false);
      }
    };
    fetchEvent();
  }, [orgId, eventId]);

  // Load venues for the org
  const fetchVenues = useCallback(async () => {
    if (!orgId) return;
    try {
      setVenuesLoading(true);
      const data = await api.get<Venue[]>(`/organizations/${orgId}/venues`);
      setVenues(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load venues');
    } finally {
      setVenuesLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  const handleLogoUpload = async (file: File) => {
    if (!orgId) return;
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('Logo must be under 5MB');
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setError('Only image files (JPG, PNG, GIF, WebP) are allowed');
      return;
    }
    try {
      setLogoUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append('logo', file);
      const result = await api.upload<EventDetail>(
        `/organizations/${orgId}/events/${eventId}/logo`,
        formData
      );
      setLogoUrl(result.logoUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to upload logo');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!orgId) return;
    try {
      setLogoUploading(true);
      setError(null);
      await api.delete(`/organizations/${orgId}/events/${eventId}/logo`);
      setLogoUrl(null);
    } catch (err: any) {
      setError(err.message || 'Failed to remove logo');
    } finally {
      setLogoUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleLogoUpload(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLogoUpload(file);
    e.target.value = '';
  };

  // Tier helpers
  const addTier = () => setPriceTiers([...priceTiers, newTierForm()]);
  const removeTier = (key: string) => {
    const tier = priceTiers.find((t) => t.key === key);
    // Only allow removing new tiers or tiers with no sales
    if (tier && !tier.isNew && tier.quantitySold > 0) return;
    setPriceTiers(priceTiers.filter((t) => t.key !== key));
  };
  const updateTier = (key: string, field: keyof TierFormInput, value: string | boolean) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const payload: Record<string, unknown> = {};

      if (name !== eventData?.name) payload.name = name;
      if (description !== (eventData?.description || '')) payload.description = description || null;
      if (venueId !== eventData?.venue?.id) payload.venueId = venueId;
      if (date !== toDatetimeLocal(eventData?.date || ''))
        payload.date = new Date(date).toISOString();
      if (capacity !== String(eventData?.capacity)) payload.capacity = parseInt(capacity);
      if (category !== (eventData?.category || '')) payload.category = category || null;

      // Save tier changes
      const tierBase = `/organizations/${orgId}/events/${eventId}/price-tiers`;
      let tiersChanged = false;

      // Create new tiers
      for (const tier of priceTiers.filter((t) => t.isNew)) {
        if (!tier.name || !tier.price || !tier.quantityTotal) continue;
        await api.post(tierBase, {
          name: tier.name,
          description: tier.description || undefined,
          price: parseFloat(tier.price),
          quantityTotal: parseInt(tier.quantityTotal),
          minPerOrder: tier.minPerOrder ? parseInt(tier.minPerOrder) : undefined,
          maxPerOrder: tier.maxPerOrder ? parseInt(tier.maxPerOrder) : undefined,
          saleStartDate: tier.saleStartDate ? new Date(tier.saleStartDate).toISOString() : null,
          saleEndDate: tier.saleEndDate ? new Date(tier.saleEndDate).toISOString() : null,
          visibility: tier.visibility,
          isRefundable: tier.isRefundable,
        });
        tiersChanged = true;
      }

      // Update existing tiers
      const originalTiers = eventData?.priceTiers || [];
      for (const tier of priceTiers.filter((t) => !t.isNew)) {
        const orig = originalTiers.find((o) => o.id === tier.key);
        if (!orig) continue;
        const patch: Record<string, unknown> = {};
        if (tier.name !== orig.name) patch.name = tier.name;
        if (tier.description !== (orig.description || '')) patch.description = tier.description || null;
        if (parseFloat(tier.price) !== Number(orig.price)) patch.price = parseFloat(tier.price);
        if (parseInt(tier.quantityTotal) !== orig.quantityTotal) patch.quantityTotal = parseInt(tier.quantityTotal);
        if ((tier.minPerOrder ? parseInt(tier.minPerOrder) : null) !== orig.minPerOrder)
          patch.minPerOrder = tier.minPerOrder ? parseInt(tier.minPerOrder) : null;
        if ((tier.maxPerOrder ? parseInt(tier.maxPerOrder) : null) !== orig.maxPerOrder)
          patch.maxPerOrder = tier.maxPerOrder ? parseInt(tier.maxPerOrder) : null;
        const newStart = tier.saleStartDate ? new Date(tier.saleStartDate).toISOString() : null;
        if (newStart !== orig.saleStartDate) patch.saleStartDate = newStart;
        const newEnd = tier.saleEndDate ? new Date(tier.saleEndDate).toISOString() : null;
        if (newEnd !== orig.saleEndDate) patch.saleEndDate = newEnd;
        if (tier.visibility !== orig.visibility) patch.visibility = tier.visibility;
        if (tier.isRefundable !== orig.isRefundable) patch.isRefundable = tier.isRefundable;

        if (Object.keys(patch).length > 0) {
          await api.patch(`${tierBase}/${tier.key}`, patch);
          tiersChanged = true;
        }
      }

      // Reorder if order changed
      const origOrder = [...originalTiers].sort((a, b) => a.displayOrder - b.displayOrder).map((t) => t.id);
      const currentExistingOrder = priceTiers.filter((t) => !t.isNew).map((t) => t.key);
      if (JSON.stringify(origOrder) !== JSON.stringify(currentExistingOrder) && currentExistingOrder.length > 0) {
        await api.post(`${tierBase}/reorder`, { tierIds: currentExistingOrder });
        tiersChanged = true;
      }

      if (Object.keys(payload).length === 0 && !tiersChanged) {
        setError('No changes to save');
        return;
      }

      if (Object.keys(payload).length > 0) {
        await api.patch(`/organizations/${orgId}/events/${eventId}`, payload);
      }
      setSuccess(true);
      setTimeout(() => router.push('/admin/events'), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to update event');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

  if (!orgId) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-red-600 dark:text-red-400">Missing organization context.</p>
        <button
          onClick={() => router.push('/admin/events')}
          className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          ← Back to Events
        </button>
      </div>
    );
  }

  if (loadingEvent) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-12 bg-gray-200 dark:bg-slate-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!eventData) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-red-600 dark:text-red-400">{error || 'Event not found'}</p>
        <button
          onClick={() => router.push('/admin/events')}
          className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          ← Back to Events
        </button>
      </div>
    );
  }

  const isPublished = eventData.status === 'PUBLISHED';
  const capacityNum = parseInt(capacity) || 0;
  const capacityExceeded = capacityNum > 0 && totalTierQuantity > capacityNum;

  const logoSrc = resolveAssetUrl(logoUrl);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Event</h1>
          {isPublished && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
              ⚠ This event is published. Changes will be visible to customers immediately.
            </p>
          )}
        </div>
        <button
          onClick={() => router.push('/admin/events')}
          className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
        >
          ← Back to Events
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
          <p className="text-sm text-green-800 dark:text-green-300">
            Event updated successfully! Redirecting…
          </p>
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
            {/* Logo Upload */}
            <div className="md:col-span-2">
              <label className={labelClass}>Event Logo</label>
              {logoSrc ? (
                <div className="flex items-start gap-4">
                  <div className="relative group">
                    <img
                      src={logoSrc}
                      alt="Event logo"
                      className="h-32 w-32 object-contain rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900"
                    />
                    {logoUploading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={logoUploading}
                      className="rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={handleLogoRemove}
                      disabled={logoUploading}
                      className="rounded-md border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  className={`relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                    dragOver
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-gray-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  {logoUploading ? (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-2" />
                      <p className="text-sm text-gray-500 dark:text-slate-400">Uploading…</p>
                    </div>
                  ) : (
                    <>
                      <svg
                        className="mx-auto h-10 w-10 text-gray-400 dark:text-slate-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          Click to upload
                        </span>{' '}
                        or drag and drop
                      </p>
                      <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
                        PNG, JPG, GIF, WebP up to 5MB
                      </p>
                    </>
                  )}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileSelect}
                className="hidden"
              />
            </div>

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
              {capacityExceeded && (
                <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                  ⚠ Capacity is below total tier inventory ({totalTierQuantity})
                </p>
              )}
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

          {priceTiers.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400 py-4 text-center">
              No price tiers. Click &quot;+ Add Tier&quot; to create one.
            </p>
          )}

          <div className="space-y-4">
            {priceTiers.map((tier, index) => (
              <div
                key={tier.key}
                className="rounded-lg border border-gray-200 dark:border-slate-600 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-500 dark:text-slate-400">
                      Tier {index + 1}
                    </span>
                    {!tier.isNew && tier.quantitySold > 0 && (
                      <span className="text-xs text-gray-400 dark:text-slate-500">
                        ({tier.quantitySold} sold)
                      </span>
                    )}
                    {tier.isNew && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400">
                        new
                      </span>
                    )}
                  </div>
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
                    {(tier.isNew || tier.quantitySold === 0) && (
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
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Description</label>
                    <textarea
                      value={tier.description}
                      onChange={(e) => updateTier(tier.key, 'description', e.target.value)}
                      placeholder="Brief description (optional)"
                      maxLength={500}
                      rows={2}
                      className={inputClass}
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
                      min={tier.isNew ? 1 : tier.quantitySold + tier.quantityReserved}
                      className={inputClass}
                      required
                    />
                    {!tier.isNew && (tier.quantitySold > 0 || tier.quantityReserved > 0) && (
                      <p className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
                        Min: {tier.quantitySold + tier.quantityReserved} (sold + reserved)
                      </p>
                    )}
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

                {/* Sale Window & Visibility */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
                  <div>
                    <label className={labelClass}>Sale Start</label>
                    <input
                      type="datetime-local"
                      value={tier.saleStartDate}
                      onChange={(e) => updateTier(tier.key, 'saleStartDate', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Sale End</label>
                    <input
                      type="datetime-local"
                      value={tier.saleEndDate}
                      onChange={(e) => updateTier(tier.key, 'saleEndDate', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Visibility</label>
                    <select
                      value={tier.visibility}
                      onChange={(e) => updateTier(tier.key, 'visibility', e.target.value)}
                      className={inputClass}
                    >
                      <option value="PUBLIC">Public</option>
                      <option value="PRIVATE">Private</option>
                      <option value="HIDDEN">Hidden</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tier.isRefundable}
                        onChange={(e) => updateTier(tier.key, 'isRefundable', e.target.checked)}
                        className="rounded border-gray-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-slate-300">Refundable</span>
                    </label>
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
            {saving ? 'Saving…' : 'Save Changes'}
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
