'use client';

// Step 3, "When is it?": start (required) and an optional end, both typed in
// the venue's wall clock through lib/eventTime.ts (gotcha 28), with the zone
// always written out. In create mode, Next here creates the draft.

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { DEFAULT_ZONE, formatEventDateTime, zonedInputToInstant } from '@/lib/eventTime';
import { FIELD_IDS } from '../steps';
import { describedBy, errorText, hintClass, inputClass, labelClass, secondaryButton, textButton } from '../ui';
import { zoneText } from './VenueStep';
import type { StepFormProps } from './types';

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
        {instant ? `${formatEventDateTime(instant, zone || DEFAULT_ZONE)} at the venue` : `In the venue's time zone: ${zoneText(zone)}`}
      </p>
      {error && (
        <p id={`${id}-error`} className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}

export default function DateStep({
  fields,
  onChange,
  errors,
  zone,
  hasVenue,
}: StepFormProps & { zone: string | null; hasVenue: boolean }) {
  const [showEnd, setShowEnd] = useState(!!fields.endDate);
  const start = zonedInputToInstant(fields.date, zone);
  const addEndRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="space-y-5">
      <p className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-slate-800 dark:text-slate-300">
        Time zone: <span className="font-medium text-gray-900 dark:text-white">{hasVenue ? zoneText(zone, start) : 'choose a venue first'}</span>
      </p>

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
          className={secondaryButton}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add end time
        </button>
      )}
    </div>
  );
}
