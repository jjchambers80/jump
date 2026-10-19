'use client';

// Step 3, "When is it?": start (required) and an optional end, both typed in
// the venue's wall clock through lib/eventTime.ts (gotcha 28), with the zone
// always written out next to the time. The zone itself comes from the address
// without asking; it is only raised here when it was a guess (zoneNeedsCheck).
// In create mode, Next here creates the draft. A registration event also sets
// when registration opens and closes here: its form is created with the row.
// The window is optional; blank = open from publish with no closing time.

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import api from '@/services/api';
import TimeZoneSelect from '@/components/TimeZoneSelect';
import type { CreatedVenue } from '@/components/VenueFlyout';
import { DEFAULT_ZONE, formatEventDateTime, zonedInputToInstant } from '@/lib/eventTime';
import { FIELD_IDS } from '../steps';
import { describedBy, errorText, hintClass, inputClass, labelClass, secondaryButton, textButton } from '../ui';
import { zoneText } from './VenueStep';
import { browserZone, viewerTimeLine, zoneNeedsCheck } from './zoneChecks';
import type { SetupVenue, StepFormProps } from './types';

function TimeField({
  id,
  label,
  value,
  zone,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  zone: string | null;
  error?: string;
  onChange: (value: string) => void;
}) {
  const instant = zonedInputToInstant(value, zone);
  const viewer = useMemo(browserZone, []);
  const yours = instant && zone ? viewerTimeLine(instant, zone, viewer) : null;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, { hint: true, error })}
        className={inputClass}
      />
      <p id={`${id}-hint`} className={hintClass}>
        {instant ? `${formatEventDateTime(instant, zone || DEFAULT_ZONE)} at the venue.` : `In the venue's time zone: ${zoneText(zone)}`}
        {yours && <span className="block">{yours}</span>}
      </p>
      {error && (
        <p id={`${id}-error`} className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Shown only when the venue's zone was guessed: the organizer confirms it or
 * picks the right one (PUT …/venues/:id/time-zone, which makes it MANUAL).
 * The typed times stay as typed and are saved in the confirmed zone on Next.
 */
function ZoneCheck({ orgId, venue, onVenueUpdated }: { orgId: string; venue: SetupVenue; onVenueUpdated: (venue: CreatedVenue) => void }) {
  const [choice, setChoice] = useState(venue.timezone || DEFAULT_ZONE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      onVenueUpdated(await api.put<CreatedVenue>(`/organizations/${orgId}/venues/${venue.id}/time-zone`, { timezone: choice }));
    } catch (err) {
      setError((err as Error).message || 'Could not save the time zone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="group"
      aria-labelledby="setup-zone-check-title"
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p id="setup-zone-check-title" className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Check the time zone before you publish
      </p>
      <p className="mt-1">
        {venue.timezoneSource === 'DEFAULT'
          ? "We couldn't work it out from the address, so times are in Eastern Time for now."
          : 'This address is near a time zone line, so we may have guessed wrong.'}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <TimeZoneSelect id="setup-zone-check" value={choice} onChange={setChoice} label="Time zone at the venue" className={inputClass} labelClassName={labelClass} />
        </div>
        {/* Secondary: Next stays the step's one primary action. */}
        <button type="button" onClick={confirm} disabled={saving} className={secondaryButton}>
          {saving ? 'Saving…' : 'Use this time zone'}
        </button>
      </div>
      {error && <p className={errorText}>{error}</p>}
    </div>
  );
}

export default function DateStep({
  fields,
  onChange,
  errors,
  zone,
  orgId,
  venue,
  onVenueUpdated,
  registrationWindow = false,
}: StepFormProps & { zone: string | null; orgId: string; venue: SetupVenue | undefined; onVenueUpdated: (venue: CreatedVenue) => void; registrationWindow?: boolean }) {
  const [showEnd, setShowEnd] = useState(!!fields.endDate);
  const addEndRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="space-y-5">
      {venue && zoneNeedsCheck(venue) && <ZoneCheck key={venue.id} orgId={orgId} venue={venue} onVenueUpdated={onVenueUpdated} />}

      <TimeField
        id={FIELD_IDS.date}
        label="Starts"
        value={fields.date}
        zone={zone}
        error={errors[FIELD_IDS.date]}
        onChange={(date) => onChange({ date })}
      />

      {showEnd ? (
        <div className="space-y-2">
          <TimeField
            id={FIELD_IDS.endDate}
            label="Ends (optional)"
            value={fields.endDate}
            zone={zone}
            error={errors[FIELD_IDS.endDate]}
            onChange={(endDate) => onChange({ endDate })}
          />
          <button
            type="button"
            onClick={() => {
              setShowEnd(false);
              onChange({ endDate: '' });
              requestAnimationFrame(() => addEndRef.current?.focus());
            }}
            className={`${textButton} -ml-3`}
          >
            Remove end time
          </button>
        </div>
      ) : (
        <button
          ref={addEndRef}
          type="button"
          onClick={() => {
            setShowEnd(true);
            requestAnimationFrame(() => document.getElementById(FIELD_IDS.endDate)?.focus());
          }}
          className={`${textButton} -ml-3`}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add end time
        </button>
      )}
      {registrationWindow && (
        <div role="group" aria-labelledby="setup-window-title" aria-describedby="setup-window-hint" className="space-y-4 border-t border-gray-200 pt-5 dark:border-slate-700">
          <div>
            <p id="setup-window-title" className={labelClass}>When registration is open</p>
            <p id="setup-window-hint" className={hintClass}>Leave blank to take registrations as soon as the event is published, until you close the form.</p>
          </div>
          <TimeField
            id={FIELD_IDS.opensAt}
            label="Registration opens (optional)"
            value={fields.opensAt ?? ''}
            zone={zone}
            error={errors[FIELD_IDS.opensAt]}
            onChange={(opensAt) => onChange({ opensAt })}
          />
          <TimeField
            id={FIELD_IDS.closesAt}
            label="Registration closes (optional)"
            value={fields.closesAt ?? ''}
            zone={zone}
            error={errors[FIELD_IDS.closesAt]}
            onChange={(closesAt) => onChange({ closesAt })}
          />
        </div>
      )}
    </div>
  );
}
