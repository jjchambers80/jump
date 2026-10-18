'use client';

// Step 1, "Name your event": the name and the listing category. The URL slug
// is derived from the name on the server; organizers never see or edit it.
// Client state until the date step creates the row; a PATCH after that.

import { EVENT_CATEGORIES, SALES_FIELD_IDS } from '../contentSteps';
import { FIELD_IDS } from '../steps';
import { describedBy, errorText, hintClass, inputClass, labelClass } from '../ui';
import type { StepFormProps } from './types';

export default function NameStep({ fields, onChange, errors }: StepFormProps) {
  const nameError = errors[FIELD_IDS.name];
  const id = FIELD_IDS.name;
  const categoryId = SALES_FIELD_IDS.category;
  const categoryError = errors[categoryId];
  const category = fields.category ?? '';
  // An event saved before the list keeps its own value as an extra option.
  const legacyCategory = category && !(EVENT_CATEGORIES as readonly string[]).includes(category) ? category : null;

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

      <div>
        <label htmlFor={categoryId} className={labelClass}>
          Category (optional)
        </label>
        <select
          id={categoryId}
          value={category}
          onChange={(e) => onChange({ category: e.target.value })}
          aria-invalid={!!categoryError || undefined}
          aria-describedby={describedBy(categoryId, { hint: true, error: categoryError })}
          className={inputClass}
        >
          <option value="">No category</option>
          {legacyCategory && <option value={legacyCategory}>{legacyCategory}</option>}
          {EVENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p id={`${categoryId}-hint`} className={hintClass}>
          Helps people find the event in listings.
        </p>
        {categoryError && (
          <p id={`${categoryId}-error`} className={errorText}>
            {categoryError}
          </p>
        )}
      </div>
    </div>
  );
}
