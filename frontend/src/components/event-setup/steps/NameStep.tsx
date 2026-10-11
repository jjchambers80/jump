'use client';

// Step 1, "Name your event": the name, and the URL slug behind "Edit URL"
// (plan §3: the slug lives in the Name step, collapsed). Client state until the
// date step creates the row; a PATCH after that.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import SlugField from '@/components/SlugField';
import { FIELD_IDS } from '../steps';
import { describedBy, errorText, hintClass, inputClass, labelClass, textButton } from '../ui';
import type { StepFormProps } from './types';

/** `savedSlug`: the live URL; changing it on a PUBLISHED event breaks shared links (050-O, as the Listing flyout warned). */
export default function NameStep({ fields, onChange, errors, status, savedSlug }: StepFormProps & { savedSlug?: string | null }) {
  const [editUrl, setEditUrl] = useState(!!fields.slug);
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
          Buyers see this on the event page, tickets and emails.
        </p>
        {nameError && (
          <p id={`${id}-error`} className={errorText}>
            {nameError}
          </p>
        )}
      </div>

      <div>
        <button
          type="button"
          aria-expanded={editUrl}
          aria-controls="setup-slug-panel"
          onClick={() => setEditUrl((open) => !open)}
          className={`${textButton} -ml-3`}
        >
          Edit URL
          <ChevronDown className={`h-4 w-4 ${editUrl ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <div id="setup-slug-panel" hidden={!editUrl} className="mt-2">
          {editUrl && (
            <SlugField
              id={FIELD_IDS.slug}
              value={fields.slug}
              onChange={(slug) => onChange({ slug })}
              source={fields.name}
              prefix="/events/"
              baseUrl={typeof window !== 'undefined' ? window.location.origin : undefined}
              error={errors[FIELD_IDS.slug]}
            />
          )}
          {status === 'PUBLISHED' && savedSlug && fields.slug && fields.slug !== savedSlug && (
            <p role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              The event is live. Links already shared with the old address stop working.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
