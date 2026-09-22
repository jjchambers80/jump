'use client';

// Create a venue without leaving the event form. The flyout carries every
// field of the full venue form on Admin › Venues (name, URL slug, address,
// timezone, public page toggle, logo), so nothing has to be finished there.
// It slides in from the right on desktop and covers the screen on phones.

import React, { useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import { StateSelect } from '@/components/StateSelect';
import SlugField from '@/components/SlugField';
import ImageUploader from '@/components/ImageUploader';
import VenueTimeZoneField from '@/components/VenueTimeZoneField';

// Sentinel value of the "+ Add new venue…" option inside a venue <select>.
export const NEW_VENUE_OPTION = '__new_venue__';

export interface CreatedVenue {
  id: string;
  name: string;
  slug?: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timezone: string;
  isPublic: boolean;
  logoUrl?: string | null;
}

interface Props {
  orgId: string;
  onClose: () => void;
  // `warning` is set when the venue itself saved but a follow-up step (the
  // logo upload) did not — the venue is still selected on the event form.
  onCreated: (venue: CreatedVenue, warning?: string) => void;
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

export default function VenueFlyout({ orgId, onClose, onCreated }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  // Spec 033: null follows the address; a value is the organizer's own choice.
  const [timezone, setTimezone] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);

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

  // Object URLs from the logo picker are revoked when they are replaced.
  useEffect(() => {
    return () => {
      if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSlugError(null);
    try {
      const venue = await api.post<CreatedVenue>(`/organizations/${orgId}/venues`, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        address: address.trim(),
        city: city.trim() || undefined,
        state: state || undefined,
        postalCode: postalCode.trim() || undefined,
        timezone: timezone ?? undefined,
        isPublic,
      });

      if (logo) {
        try {
          const uploadData = new FormData();
          uploadData.append('logo', logo);
          await api.upload(`/organizations/${orgId}/venues/${venue.id}/logo`, uploadData);
        } catch (uploadError) {
          onCreated(
            venue,
            `${venue.name} was created, but its logo could not be uploaded: ${
              (uploadError as Error).message || 'Upload failed'
            }. Add it under Venues.`
          );
          return;
        }
      }

      onCreated(venue);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = (err as Error).message || 'Could not create the venue';
      if (status === 409) setSlugError(message);
      else setError(message);
      setSaving(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="venue-flyout-title"
      className="fixed inset-0 z-50 flex justify-end"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden />

      <form
        onSubmit={submit}
        data-testid="venue-flyout"
        className="relative flex h-full w-full max-w-full flex-col bg-white shadow-xl motion-safe:animate-slide-up dark:bg-slate-800 sm:max-w-xl sm:motion-safe:animate-slide-in-right"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-slate-700 sm:px-6">
          <h3 id="venue-flyout-title" className="text-lg font-semibold text-gray-900 dark:text-white">
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

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            The venue is selected for this event as soon as it is saved.
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
            <label htmlFor="venue-flyout-name" className={labelClass}>
              Name *
            </label>
            <input
              id="venue-flyout-name"
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

          <SlugField
            id="venue-flyout-slug"
            value={slug}
            onChange={setSlug}
            source={name}
            prefix="/venues/"
            baseUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
            error={slugError}
          />

          <div>
            <label htmlFor="venue-flyout-address" className={labelClass}>
              Street address *
            </label>
            <input
              id="venue-flyout-address"
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
              <label htmlFor="venue-flyout-city" className={labelClass}>
                City
              </label>
              <input
                id="venue-flyout-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Raleigh"
                className={inputClass}
              />
            </div>
            <StateSelect id="venue-flyout-state" value={state} onChange={setState} />
            <div>
              <label htmlFor="venue-flyout-postal" className={labelClass}>
                Postal code
              </label>
              <input
                id="venue-flyout-postal"
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="e.g. 27601"
                className={inputClass}
              />
            </div>
          </div>

          <VenueTimeZoneField
            id="venue-flyout-timezone"
            state={state}
            postalCode={postalCode}
            value={timezone}
            onChange={setTimezone}
            className={inputClass}
            labelClassName={labelClass}
          />

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="venue-flyout-public"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="venue-flyout-public" className="text-sm text-gray-700 dark:text-slate-300">
              Public venue page enabled. When disabled, the public URL returns not found.
            </label>
          </div>

          <div>
            <label className={labelClass}>Venue logo</label>
            <ImageUploader
              currentPreview={logoPreview}
              onFileSelect={(file) => {
                setLogo(file);
                setLogoPreview(URL.createObjectURL(file));
              }}
              onRemove={() => {
                setLogo(null);
                setLogoPreview(null);
              }}
              uploading={saving}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 px-4 py-4 dark:border-slate-700 sm:px-6">
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
