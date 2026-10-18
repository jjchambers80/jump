'use client';

// Step 2 when Venues is off or hidden for the role (System › Roles): a plain
// address instead of a venue picker. "Use this address" finds or creates a
// private venue behind it (POST …/venues/from-address), so the event keeps a
// venue for its time zone, tax region and organization like every other event.

import { useState } from 'react';
import api from '@/services/api';
import { StateSelect } from '@/components/StateSelect';
import VenueTimeZoneField from '@/components/VenueTimeZoneField';
import type { CreatedVenue } from '@/components/VenueFlyout';
import { FIELD_IDS } from '../steps';
import { describedBy, errorText, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from '../ui';
import type { SetupVenue, StepFormProps } from './types';
import { zoneText } from './VenueStep';

export default function LocationStep({
  fields,
  errors,
  status,
  orgId,
  venues,
  onVenueCreated,
  zoneNotice,
}: StepFormProps & { orgId: string; venues: SetupVenue[]; onVenueCreated: (venue: CreatedVenue) => void; zoneNotice: string | null }) {
  const current = venues.find((v) => v.id === fields.venueId);
  const [editing, setEditing] = useState(!current);
  const [form, setForm] = useState(() => ({
    // A place name equal to the street is the "no name" default (see save).
    name: current && current.name !== current.address ? current.name : '',
    address: current?.address ?? '',
    city: current?.city ?? '',
    state: current?.state ?? '',
    postalCode: current?.postalCode ?? '',
    // Spec 033: null follows the address; a value is the organizer's own choice.
    timezone: current?.timezoneSource === 'MANUAL' ? current.timezone : (null as string | null),
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const id = FIELD_IDS.venueId;
  const error = saveError ?? errors[id];
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    const address = form.address.trim();
    if (!address) {
      setSaveError('Enter the street address');
      return;
    }
    // Without either the zone falls back to Eastern without a word.
    if (!form.state && !form.postalCode.trim()) {
      setSaveError('Enter the state or ZIP code: it sets the time zone');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const venue = await api.post<CreatedVenue>(`/organizations/${orgId}/venues/from-address`, {
        name: form.name.trim() || address,
        address,
        city: form.city.trim() || undefined,
        state: form.state || undefined,
        postalCode: form.postalCode.trim() || undefined,
        timezone: form.timezone ?? undefined,
      });
      onVenueCreated(venue);
      setEditing(false);
    } catch (err) {
      setSaveError((err as Error).message || 'Could not save the address');
    } finally {
      setSaving(false);
    }
  };

  if (!editing && current) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
          {current.name !== current.address && <p className="font-medium text-gray-900 dark:text-white">{current.name}</p>}
          <p className="text-sm text-gray-700 dark:text-slate-300">
            {[current.address, current.city, current.state].filter(Boolean).join(', ')}
          </p>
          <p className={hintClass}>Times for this event are in {zoneText(current.timezone)}.</p>
        </div>
        {zoneNotice ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {zoneNotice}
          </p>
        ) : (
          status === 'PUBLISHED' && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              This event is live. A new address keeps the start time as typed and moves it to that address&apos;s time zone.
            </p>
          )
        )}
        <button type="button" onClick={() => setEditing(true)} className={secondaryButton}>
          Change address
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="setup-location-name" className={labelClass}>
          Place name <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
        </label>
        <input
          id="setup-location-name"
          type="text"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Raleigh Convention Center"
          maxLength={255}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={id} className={labelClass}>
          Street address
        </label>
        <input
          id={id}
          type="text"
          value={form.address}
          onChange={(e) => set({ address: e.target.value })}
          autoComplete="street-address"
          maxLength={500}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy(id, { hint: true, error })}
          className={inputClass}
        />
        <p id={`${id}-hint`} className={hintClass}>
          The address sets the time zone for every time on this event.
        </p>
        {error && (
          <p id={`${id}-error`} className={errorText}>
            {error}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="setup-location-city" className={labelClass}>
            City
          </label>
          <input
            id="setup-location-city"
            type="text"
            value={form.city}
            onChange={(e) => set({ city: e.target.value })}
            autoComplete="address-level2"
            className={inputClass}
          />
        </div>
        <StateSelect id="setup-location-state" value={form.state} onChange={(state) => set({ state })} />
        <div>
          <label htmlFor="setup-location-postal" className={labelClass}>
            ZIP code
          </label>
          <input
            id="setup-location-postal"
            type="text"
            value={form.postalCode}
            onChange={(e) => set({ postalCode: e.target.value })}
            autoComplete="postal-code"
            inputMode="numeric"
            className={inputClass}
          />
        </div>
      </div>
      <VenueTimeZoneField
        id="setup-location-timezone"
        state={form.state}
        postalCode={form.postalCode}
        value={form.timezone}
        onChange={(timezone) => set({ timezone })}
        className={inputClass}
        labelClassName={labelClass}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving} className={primaryButton}>
          {saving ? 'Saving…' : 'Use this address'}
        </button>
        {current && (
          <button type="button" onClick={() => setEditing(false)} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
