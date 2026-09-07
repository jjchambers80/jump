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

      if (Object.keys(payload).length === 0) {
        setError('No changes to save');
        return;
      }

      await api.patch(`/organizations/${orgId}/events/${eventId}`, payload);
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
  const totalTierQuantity = eventData.priceTiers.reduce((s, t) => s + t.quantityTotal, 0);
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

        {/* Price Tiers (read-only summary) */}
        {eventData.priceTiers.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Price Tiers
            </h2>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Price tiers can be managed from the event list (Show Tiers).
            </p>
            <div className="space-y-2">
              {eventData.priceTiers
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((tier) => (
                  <div
                    key={tier.id}
                    className="rounded-md border border-gray-200 dark:border-slate-600 px-4 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-slate-100">
                          {tier.name}
                        </span>
                        <span className="text-gray-500 dark:text-slate-400">
                          ${Number(tier.price).toFixed(2)}
                        </span>
                        {tier.visibility !== 'PUBLIC' && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                            tier.visibility === 'HIDDEN'
                              ? 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                              : 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
                          }`}>
                            {tier.visibility.toLowerCase()}
                          </span>
                        )}
                        {tier.isRefundable && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400">
                            refundable
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-slate-400">
                        {tier.quantitySold} sold / {tier.quantityTotal} total
                      </div>
                    </div>
                    {tier.description && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{tier.description}</p>
                    )}
                    {(tier.saleStartDate || tier.saleEndDate) && (
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400 dark:text-slate-500">
                        {tier.saleStartDate && (
                          <span>Starts: {new Date(tier.saleStartDate).toLocaleDateString()}</span>
                        )}
                        {tier.saleEndDate && (
                          <span>Ends: {new Date(tier.saleEndDate).toLocaleDateString()}</span>
                        )}
                        <span className={`font-medium ${
                          tier.saleStatus === 'ON_SALE'
                            ? 'text-green-600 dark:text-green-400'
                            : tier.saleStatus === 'NOT_STARTED'
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-gray-500 dark:text-slate-500'
                        }`}>
                          {tier.saleStatus === 'ON_SALE' ? 'On Sale' : tier.saleStatus === 'NOT_STARTED' ? 'Not Started' : 'Ended'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

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
