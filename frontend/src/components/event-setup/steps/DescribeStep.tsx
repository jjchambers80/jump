'use client';

// Step 4, "Describe it": the rich-text description (Tiptap through
// RichTextEditorField, ssr:false; the backend sanitises on write, gotcha 20)
// and the listing category. Both go out in the event PATCH, so a draft
// autosaves them; the preview shows the description once the server has it.

import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { SALES_FIELD_IDS } from '../contentSteps';
import { describedBy, errorText, hintClass, inputClass, labelClass } from '../ui';
import type { StepFormProps } from './types';

export default function DescribeStep({ fields, onChange, errors }: StepFormProps) {
  const categoryId = SALES_FIELD_IDS.category;
  const categoryError = errors[categoryId];

  return (
    <div className="space-y-6">
      <div>
        <p id="setup-description-label" className={labelClass}>
          Description
        </p>
        <RichTextEditorField
          value={fields.description ?? ''}
          onChange={(description) => onChange({ description })}
          variant="full"
          placeholder="What happens, who it is for, what to bring"
          aria-labelledby="setup-description-label"
          testId="setup-description"
        />
        <p className={hintClass}>Shown under &ldquo;About this event&rdquo;. Headings, lists and links are kept.</p>
      </div>

      <div>
        <label htmlFor={categoryId} className={labelClass}>
          Category (optional)
        </label>
        <input
          id={categoryId}
          type="text"
          value={fields.category ?? ''}
          onChange={(e) => onChange({ category: e.target.value })}
          placeholder="e.g. Music, Sports, Conference"
          maxLength={100}
          aria-invalid={!!categoryError || undefined}
          aria-describedby={describedBy(categoryId, { hint: true, error: categoryError })}
          className={inputClass}
        />
        <p id={`${categoryId}-hint`} className={hintClass}>
          Helps buyers find the event in listings.
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
