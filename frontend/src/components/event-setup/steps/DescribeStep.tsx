'use client';

// Step 4, "Describe it": the rich-text description (Tiptap through
// RichTextEditorField, ssr:false; the backend sanitises on write, gotcha 20).
// It goes out in the event PATCH, so a draft autosaves it; the preview shows
// the description once the server has it. The category is on the Name step.

import RichTextEditorField from '@/components/editor/RichTextEditorField';
import { hintClass, labelClass } from '../ui';
import type { StepFormProps } from './types';

export default function DescribeStep({ fields, onChange, hint }: StepFormProps & { hint?: string }) {
  return (
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
      <p className={hintClass}>{hint ?? <>Shown under &ldquo;About this event&rdquo;.</>} Headings, lists and links are kept.</p>
    </div>
  );
}
