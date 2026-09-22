'use client';

// Create a venue without leaving the event form. Covers the fields the
// backend requires plus the address; slug, logo and the public page toggle
// stay on Admin › Venues, which the dialog links to.

import React, { useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { StateSelect } from '@/components/StateSelect';

export interface CreatedVenue {
  id: string;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timezone: string;
  isPublic: boolean;
}

interface Props {
  orgId: string;
  onClose: () => void;
  onCreated: (venue: CreatedVenue) => void;
}

const inputClass =
  'block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export default function QuickVenueDialog({ orgId, onClose, onCreated }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const venue = await api.post<CreatedVenue>(`/organizations/${orgId}/venues`, {
        name: name.trim(),
        address: address.trim(),
        city: city.trim() || undefined,
        state: state || undefined,
        postalCode: postalCode.trim() || undefined,
        timezone: timezone.trim() || undefined,
        isPublic: true,
      });
      onCreated(venue);
    } catch (err) {
      setError((err as Error).message || 'Could not create the venue');
      setSaving(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-venue-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="fixed inset-0 bg-black/50" />

      <form
        onSubmit={submit}
        data-testid="quick-venue-dialog"
        className="relative w-full sm:max-w-lg rounded-t-xl sm:rounded-lg bg-white dark:bg-slate-800 max-h-[90vh] overflow-y-auto shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
          <h3 id="quick-venue-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            New venue
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-6 py-4">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            The venue is selected for this event as soon as it is saved. Add a logo or change its
            URL later under Venues.
          </p>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div>
            <label htmlFor="quick-venue-name" className={labelClass}>
              Name *
            </label>
            <input
              id="quick-venue-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Venue name"
              maxLength={255}
              className={inputClass}
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="quick-venue-address" className={labelClass}>
              Street address *
            </label>
            <input
              id="quick-venue-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St"
              maxLength={500}
              className={inputClass}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="quick-venue-city" className={labelClass}>
                City
              </label>
              <input
                id="quick-venue-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Raleigh"
                className={inputClass}
              />
            </div>
            <StateSelect id="quick-venue-state" value={state} onChange={setState} />
            <div>
              <label htmlFor="quick-venue-postal" className={labelClass}>
                Postal code
              </label>
              <input
                id="quick-venue-postal"
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="e.g. 27601"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="quick-venue-timezone" className={labelClass}>
              Timezone
            </label>
            <input
              id="quick-venue-timezone"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create venue'}
          </button>
        </div>
      </form>
    </div>
  );
}
