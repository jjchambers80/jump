'use client';

// Spec 033 phase 2: organizers do not think in IANA identifiers, so the venue
// forms stopped asking for one. The zone is derived from the address and shown
// as a line of text, with the picker behind "Change".
//
// Derive-and-DISPLAY, not derive-and-hide: ZIP → zone is ~99.9% right, not 100%
// (Arizona/Navajo, Indiana, Kentucky, Tennessee, the Florida panhandle, El Paso,
// Malheur County, the Michigan UP…). A silently wrong zone prints a wrong time
// on a ticket and someone misses a show, so the resolved zone stays visible and
// a low-confidence result asks instead of asserting.

import { useEffect, useMemo, useRef, useState } from 'react';
import TimeZoneSelect from '@/components/TimeZoneSelect';
import { timeZoneLabel } from '@/lib/timeZones';
import { DEFAULT_ZONE, resolveVenueTimeZone } from '@/lib/usTimeZones';

interface Props {
  /** Prefix for the field ids, so two of these can share a page. */
  id: string;
  state: string;
  postalCode: string;
  country?: string;
  /** The organizer's explicit choice, or null to follow the address. */
  value: string | null;
  onChange: (timezone: string | null) => void;
  className?: string;
  labelClassName?: string;
}

export default function VenueTimeZoneField({
  id,
  state,
  postalCode,
  country = 'US',
  value,
  onChange,
  className,
  labelClassName,
}: Props) {
  const derived = useMemo(
    () => resolveVenueTimeZone({ country, state, postalCode }),
    [country, state, postalCode]
  );

  const effective = value ?? derived.timezone ?? DEFAULT_ZONE;
  const needsConfirmation = value === null && !derived.confident;

  const [open, setOpen] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Return focus to the trigger when the picker closes, not on first render.
  useEffect(() => {
    if (wasOpen.current && !open) changeRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const showPicker = open || needsConfirmation;

  return (
    <div data-testid={`${id}-wrapper`}>
      <span className={labelClassName} id={`${id}-label`}>
        Times
      </span>

      {!showPicker && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-900 dark:text-slate-100">
          <span data-testid={`${id}-resolved`}>{timeZoneLabel(effective)}</span>
          <button
            type="button"
            ref={changeRef}
            onClick={() => setOpen(true)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            aria-describedby={`${id}-label`}
          >
            Change
          </button>
        </p>
      )}

      {showPicker && (
        <div className="mt-1">
          {needsConfirmation && (
            <p className="mb-1 text-sm text-amber-700 dark:text-amber-400" data-testid={`${id}-confirm`}>
              Confirm the time zone — this address sits near a time zone line.
            </p>
          )}
          <TimeZoneSelect
            id={`${id}-select`}
            value={effective}
            onChange={(zone) => {
              onChange(zone);
              setOpen(false);
            }}
            label="Time zone"
            className={className}
            labelClassName="sr-only"
          />
          {value !== null && derived.timezone && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mt-1 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              Use the address instead ({timeZoneLabel(derived.timezone)})
            </button>
          )}
        </div>
      )}

      {!showPicker && (
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          {value === null
            ? 'Set from the address. Event times are shown to customers in this zone.'
            : 'Set by you. Event times are shown to customers in this zone.'}
        </p>
      )}
    </div>
  );
}
