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
import DoneStep from './steps/DoneStep';
import ReviewStep, { type ReviewStepProps } from './review/ReviewStep';
import StartFromPastEvent from './StartFromPastEvent';
import DescribeStep from './steps/DescribeStep';
import ImageStep from './steps/ImageStep';
import TicketsStep from './steps/TicketsStep';
import CollectMoreStep from './steps/CollectMoreStep';
import ApplicationsStep from './steps/ApplicationsStep';
import { isApplicationStep } from './applicationSteps';
import type { SetupForms } from './useSetupForms';
import type { EventStep, FieldError, SavedEvent, SetupFields } from './steps';
import type { SavedRowProps, SetupVenue } from './steps/types';

const INTRO: Partial<Record<EventStep['key'], string>> = {
  name: 'The name buyers will see and search for.',
  venue: 'Where it happens. The venue sets the time zone for every time on this event.',
  date: 'When it starts, and if you like, when it ends.',
  review: 'Check what buyers will see, then publish.',
  description: 'What buyers read before they decide. You can change it any time.',
  image: 'The picture at the top of the event page.',
  tickets: 'Sell tickets in tiers, or take free RSVPs.',
  'collect-more': 'Extras buyers can add to their order, like parking or merch.',
  vendors: 'Let vendors apply for a space. Add one form, or several (for example food and crafts).',
  'special-guests': 'Let artists, creators and celebrities apply to appear.',
  volunteers: 'Let people sign up to help, with your own questions.',
  'other-applications': 'Sponsors, press, panels and anything else people apply for.',
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
  /** The server row; null before the date step creates it. */
  event: SavedEvent | null;
  review: Pick<ReviewStepProps, 'createMode' | 'flush' | 'onFinished' | 'onBusyChange'>;
  /** Steps 5–6 save on their own; null before the row exists. */
  row: Omit<SavedRowProps, 'orgId'> | null;
  /** Collect more saved an add-on: the new count (step state) and a preview refresh. */
  onAddOnsSaved: (addOnCount: number) => void;
  /** The event's application forms (steps 8, 10–12). */
  forms: SetupForms;
}

const StepContent = forwardRef<HTMLHeadingElement, Props>(function StepContent(props, headingRef) {
  const { step, fields, onChange, summary, summaryRef, onOpenStep, status, readOnly } = props;
  const form = { fields, onChange, errors: Object.fromEntries(props.inline.map((e) => [e.field, e.message])), status };
  if (step.key === 'done' && props.event) return <DoneStep ref={headingRef} event={props.event} orgId={props.orgId} />;

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
          {step.key === 'date' && <DateStep {...form} zone={props.zone} hasVenue={props.venues.some((v) => v.id === fields.venueId)} />}
          {step.key === 'review' && props.event && <ReviewStep orgId={props.orgId} saved={props.event} {...props.review} />}
          {step.key === 'description' && <DescribeStep {...form} />}
          {step.key === 'image' && props.row && <ImageStep orgId={props.orgId} {...props.row} />}
          {step.key === 'tickets' && props.row && <TicketsStep {...form} orgId={props.orgId} {...props.row} readOnly={readOnly} />}
          {step.key === 'collect-more' && props.event && (
            <CollectMoreStep orgId={props.orgId} eventId={props.event.id} ticketed={props.event.admissionMode !== 'RSVP'} onSaved={props.onAddOnsSaved} />
          )}
          {isApplicationStep(step.key) && props.row && (
            <ApplicationsStep stepKey={step.key} orgId={props.orgId} eventId={props.row.saved.id} eventName={props.row.saved.name} forms={props.forms} refreshPreview={props.row.refreshPreview} />
          )}
          {!step.built && <PendingStep />}
        </fieldset>
        {step.key === 'name' && !props.event && props.orgId && <StartFromPastEvent orgId={props.orgId} />}
      </div>
    </div>
  );
});

export default StepContent;
