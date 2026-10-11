'use client';

// The current step's form under its h1 (focus target on every step change)
// and the error summary. Fades in on change; no slide, and nothing at all under
// reduced motion (§11.4).

import { forwardRef } from 'react';
import type { CreatedVenue } from '@/components/VenueFlyout';
import ErrorSummary from './ErrorSummary';
import NameStep from './steps/NameStep';
import VenueStep from './steps/VenueStep';
import DateStep from './steps/DateStep';
import PendingStep from './steps/PendingStep';
import type { EventStep, FieldError, SetupFields } from './steps';
import type { SetupVenue } from './steps/types';

const INTRO: Partial<Record<EventStep['key'], string>> = {
  name: 'The name buyers will see and search for.',
  venue: 'Where it happens. The venue sets the time zone for every time on this event.',
  date: 'When it starts, and if you like, when it ends.',
};

interface Props {
  step: EventStep;
  fields: SetupFields;
  onChange: (patch: Partial<SetupFields>) => void;
  /** The error summary's list, and the inline messages per field. */
  summary: FieldError[];
  inline: FieldError[];
  summaryRef: React.RefObject<HTMLDivElement>;
  onOpenStep: (error: FieldError) => void;
  status: string | null;
  orgId: string;
  venues: SetupVenue[];
  zone: string | null;
  readOnly: boolean;
  onVenueCreated: (venue: CreatedVenue) => void;
}

const StepContent = forwardRef<HTMLHeadingElement, Props>(function StepContent(props, headingRef) {
  const { step, fields, onChange, summary, summaryRef, onOpenStep, status, readOnly } = props;
  const form = { fields, onChange, errors: Object.fromEntries(props.inline.map((e) => [e.field, e.message])), status };

  return (
    <div key={step.key} className="mx-auto w-full max-w-[640px] px-4 py-6 motion-safe:animate-fade-in sm:px-6 sm:py-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight text-gray-900 focus:outline-none dark:text-white"
      >
        {step.title}
      </h1>
      {INTRO[step.key] && <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{INTRO[step.key]}</p>}
      <div className="mt-6">
        <ErrorSummary ref={summaryRef} errors={summary} onOpenStep={onOpenStep} />
        {readOnly && (
          <p role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            You don&apos;t have access to change this.
          </p>
        )}
        <fieldset disabled={readOnly} className="min-w-0">
          <legend className="sr-only">{step.title}</legend>
          {step.key === 'name' && <NameStep {...form} />}
          {step.key === 'venue' && <VenueStep {...form} orgId={props.orgId} venues={props.venues} onVenueCreated={props.onVenueCreated} />}
          {step.key === 'date' && <DateStep {...form} zone={props.zone} />}
          {!step.built && <PendingStep />}
        </fieldset>
      </div>
    </div>
  );
});

export default StepContent;
