'use client';

// Step 2, "Where is it?": pick one of the organization's venues or add one in
// place (VenueFlyout). The venue's time zone is shown read-only: event times
// are the venue's wall clock (gotcha 28), and the zone belongs to the venue.

import { useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import VenueFlyout, { type CreatedVenue } from '@/components/VenueFlyout';
import { DEFAULT_ZONE, zoneAbbreviation } from '@/lib/eventTime';
import { timeZoneLabel } from '@/lib/timeZones';
import { FIELD_IDS } from '../steps';
import { describedBy, errorText, hintClass, inputClass, labelClass, secondaryButton } from '../ui';
import type { SetupVenue, StepFormProps } from './types';

/**
 * The zone as words, never blank (gotcha 28). The abbreviation (EST / EDT)
 * belongs to the event's own date, so it shows only once there is one; a
 * venue without a zone says so and names the fallback the times use.
 */
export function zoneText(zone: string | null | undefined, at?: Date | null) {
  const resolved = zone || DEFAULT_ZONE;
  const label = at ? `${zoneAbbreviation(at, resolved)}, ${timeZoneLabel(resolved, at)}` : timeZoneLabel(resolved);
  return zone ? label : `Venue time zone not set; using ${label}`;
}

export default function VenueStep({
  fields,
  onChange,
  errors,
  status,
  orgId,
  venues,
  onVenueCreated,
}: StepFormProps & {
  orgId: string;
  venues: SetupVenue[];
  onVenueCreated: (venue: CreatedVenue) => void;
}) {
  const [adding, setAdding] = useState(false);
  const id = FIELD_IDS.venueId;
  const error = errors[id];
  const venue = venues.find((v) => v.id === fields.venueId);

  const flyout = adding && (
    <VenueFlyout
      orgId={orgId}
      onClose={() => setAdding(false)}
      onCreated={(created) => {
        setAdding(false);
        onVenueCreated(created);
      }}
    />
  );

  if (venues.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-slate-600">
        <MapPin className="mx-auto h-6 w-6 text-gray-500 dark:text-slate-400" aria-hidden />
        <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">
          No venues yet. Add the place your event happens; its address sets the time zone.
        </p>
        <button id={id} type="button" onClick={() => setAdding(true)} className={`${secondaryButton} mt-4`}>
          <Plus className="h-4 w-4" aria-hidden />
          Add a venue
        </button>
        {error && <p className={errorText}>{error}</p>}
        {flyout}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={id} className={labelClass}>
          Venue
        </label>
        <select
          id={id}
          value={fields.venueId}
          onChange={(e) => onChange({ venueId: e.target.value })}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy(id, { hint: true, error })}
          className={inputClass}
        >
          <option value="">Choose a venue</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.address ? ` — ${v.address}` : ''}
            </option>
          ))}
        </select>
        <p id={`${id}-hint`} className={hintClass}>
          {venue?.timezone
            ? `Times for this event are in the venue's time zone: ${zoneText(venue.timezone)}.`
            : 'Times for this event are entered in the venue’s time zone.'}
        </p>
        {error && (
          <p id={`${id}-error`} className={errorText}>
            {error}
          </p>
        )}
      </div>

      {status === 'PUBLISHED' && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          This event is live. A new venue keeps the start time as typed and moves it to the new venue&apos;s time zone.
        </p>
      )}

      <button type="button" onClick={() => setAdding(true)} className={secondaryButton}>
        <Plus className="h-4 w-4" aria-hidden />
        New venue
      </button>
      {flyout}
    </div>
  );
}
