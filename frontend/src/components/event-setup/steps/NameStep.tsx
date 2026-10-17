'use client';

// Step 1, "Name your event". The URL slug is derived from the name on the
// server; organizers never see or edit it. Client state until the date step
// creates the row; a PATCH after that.

import { FIELD_IDS } from '../steps';
import { describedBy, errorText, hintClass, inputClass, labelClass } from '../ui';
import type { StepFormProps } from './types';

export default function NameStep({ fields, onChange, errors }: StepFormProps) {
  const nameError = errors[FIELD_IDS.name];
  const id = FIELD_IDS.name;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={id} className={labelClass}>
          Event name
        </label>
        <input
          id={id}
          type="text"
          value={fields.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={255}
          autoComplete="off"
          aria-invalid={!!nameError || undefined}
          aria-describedby={describedBy(id, { hint: true, error: nameError })}
          className={inputClass}
        />
        <p id={`${id}-hint`} className={hintClass}>
          {fields.type === 'REGISTRATION' ? 'Registrants see this on the event page and in emails.' : 'Buyers see this on the event page, tickets and emails.'}
        </p>
        {nameError && (
          <p id={`${id}-error`} className={errorText}>
            {nameError}
          </p>
        )}
      </div>
    </div>
  );
}
