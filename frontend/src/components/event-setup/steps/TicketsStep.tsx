'use client';

// Step 6, "Tickets or RSVP" (spec 050 §5.1 row 6). The admission mode, locked
// once orders or RSVPs exist (the reason is written out, §11.3 Locked). Ticketed:
// capacity plus the tier list; tier inventory over capacity warns here and only
// blocks at publish (readiness TIERS_EXCEED_CAPACITY). RSVP: the RSVP settings
// and no tiers (gotcha 29: branch on the mode, never on the tier count).
// Mode, capacity and RSVP settings go out in the event PATCH; tiers save on
// their own dialogs.

import { AlertTriangle } from 'lucide-react';
import { AdmissionModeField, RsvpSettingsFields } from '@/components/events/EventFormLayout';
import { capacityOverflow } from '@/components/events/tierForm';
import { SALES_FIELD_IDS, modeOf } from '../contentSteps';
import { describedBy, errorText, hintClass, inputClass, labelClass } from '../ui';
import TierList from './TierList';
import type { SavedRowProps, StepFormProps } from './types';

const LOCK_ID = 'setup-admission-lock';
const WARNING_ID = 'setup-capacity-warning';

export default function TicketsStep(props: StepFormProps & SavedRowProps & { readOnly?: boolean }) {
  const { fields, onChange, errors, saved } = props;
  const mode = modeOf({ fields, saved, zone: null, savedZone: null });
  const lock = saved.admissionLock ?? null;
  const capacityId = SALES_FIELD_IDS.capacity;
  const capacityError = errors[capacityId];
  const overflow = mode === 'TICKETED' ? capacityOverflow(fields.capacity, saved.tiers ?? []) : null;

  return (
    <div className="space-y-6">
      <div>
        {/* The fieldset's legend names the group; this is its visible twin. */}
        <p aria-hidden className={labelClass}>
          Admission mode
        </p>
        <AdmissionModeField
          value={mode}
          onChange={(next) => !lock && onChange({ admissionMode: next })}
          isDisabled={(option) => !!lock && option !== mode}
          describedBy={lock ? LOCK_ID : 'setup-admission-hint'}
        />
        {lock ? (
          <p id={LOCK_ID} className="mt-2 text-sm text-amber-800 dark:text-amber-300">
            {lock}
          </p>
        ) : (
          <p id="setup-admission-hint" className={hintClass}>
            Ticketed sells tiers through checkout. RSVP takes free sign-ups, with no tickets or orders.
          </p>
        )}
      </div>

      {mode === 'TICKETED' ? (
        <>
          <div>
            <label htmlFor={capacityId} className={labelClass}>
              Capacity
            </label>
            <input
              id={capacityId}
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              value={fields.capacity ?? ''}
              onChange={(e) => onChange({ capacity: e.target.value })}
              placeholder="1–100,000"
              aria-invalid={!!capacityError || undefined}
              aria-describedby={[describedBy(capacityId, { hint: true, error: capacityError }), overflow && WARNING_ID].filter(Boolean).join(' ') || undefined}
              className={`${inputClass} sm:max-w-48`}
            />
            <p id={`${capacityId}-hint`} className={hintClass}>
              The most people the event can hold. Needed to publish.
            </p>
            {capacityError && (
              <p id={`${capacityId}-error`} className={errorText}>
                {capacityError}
              </p>
            )}
            {overflow && (
              <p
                id={WARNING_ID}
                className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">Over capacity:</span> tiers add up to {overflow.total}, more than the capacity of{' '}
                  {overflow.capacity}. You can keep going; publishing needs the tiers to fit.
                </span>
              </p>
            )}
          </div>
          <TierList {...props} />
        </>
      ) : (
        <RsvpSettingsFields
          limitEnabled={!!fields.rsvpLimitEnabled}
          onLimitEnabledChange={(rsvpLimitEnabled) => onChange({ rsvpLimitEnabled })}
          limit={fields.rsvpLimit ?? ''}
          onLimitChange={(rsvpLimit) => onChange({ rsvpLimit })}
          maxPartySize={fields.rsvpMaxPartySize ?? '1'}
          onMaxPartySizeChange={(rsvpMaxPartySize) => onChange({ rsvpMaxPartySize })}
          errors={{ limit: errors[SALES_FIELD_IDS.rsvpLimit], maxPartySize: errors[SALES_FIELD_IDS.rsvpMaxPartySize] }}
        />
      )}
    </div>
  );
}
