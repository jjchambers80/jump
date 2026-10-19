'use client';

// The current step's form under its h1 (focus target on every step change)
// and the error summary. Fades in on change; no slide, and nothing at all under
// reduced motion (§11.4).

import { forwardRef } from 'react';
import type { CreatedVenue } from '@/components/VenueFlyout';
import ErrorSummary from './ErrorSummary';
import NameStep from './steps/NameStep';
import TypeStep from './steps/TypeStep';
import LinkedEventField from './steps/LinkedEventField';
import VenueStep from './steps/VenueStep';
import LocationStep from './steps/LocationStep';
import { useCan } from '@/components/OrgContext';
import DateStep from './steps/DateStep';
import { zoneMoveNotice } from './steps/zoneChecks';
import PendingStep from './steps/PendingStep';
import DoneStep from './steps/DoneStep';
import ReviewStep, { type ReviewStepProps } from './review/ReviewStep';
import StartFromPastEvent from './StartFromPastEvent';
import DescribeStep from './steps/DescribeStep';
import ImageStep from './steps/ImageStep';
import TicketsStep from './steps/TicketsStep';
import CollectMoreStep from './steps/CollectMoreStep';
import { eventTypeOf, type EventStep, type FieldError, type SavedEvent, type SetupFields } from './steps';
import type { SavedRowProps, SetupVenue } from './steps/types';
import type { EventVenue } from '@/app/events/[eventId]/eventPage';

const INTRO: Partial<Record<EventStep['key'], string>> = {
  type: 'Pick what people do: come to it, or register for it. You set up the rest next.',
  name: 'The name buyers will see and search for.',
  venue: 'Where it happens. Its address sets the time zone for every time on this event.',
  date: 'When it starts, and if you like, when it ends.',
  review: 'Check what buyers will see, then publish.',
  description: 'What buyers read before they decide. You can change it any time.',
  image: 'Shown at the top of the event page and on event cards. A wide image (16:9) works best.',
  tickets: 'Sell tickets in tiers, or take free RSVPs.',
  'collect-more': 'Extras buyers can add to their order, like parking or merch.',
};

/** Spec 057: a registration event's steps speak to registrants, not buyers. */
const REGISTRATION_INTRO: Partial<Record<EventStep['key'], string>> = {
  name: 'The name and description registrants will see, above the form.',
  review: 'Check what registrants will see, then publish.',
  'collect-more': 'Extras registrants can add when they choose and pay, like power or a table.',
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
  /** Location step: the address as typed, for the live preview (undefined = none). */
  onVenueDraft: (venue: EventVenue | null | undefined) => void;
  /** The server row; null before the date step creates it. */
  event: SavedEvent | null;
  review: Pick<ReviewStepProps, 'createMode' | 'flush' | 'onFinished' | 'onBusyChange' | 'footerSlot'>;
  /** Steps 5–6 save on their own; null before the row exists. */
  row: Omit<SavedRowProps, 'orgId'> | null;
  /** Collect more saved an add-on: the new count (step state) and a preview refresh. */
  onAddOnsSaved: (addOnCount: number) => void;
}

const StepContent = forwardRef<HTMLHeadingElement, Props>(function StepContent(props, headingRef) {
  const { step, fields, onChange, summary, summaryRef, onOpenStep, status, readOnly } = props;
  // Venues off or hidden for the role (System › Roles): a plain address instead.
  const venuesOn = useCan('venues');
  const form = { fields, onChange, errors: Object.fromEntries(props.inline.map((e) => [e.field, e.message])), status };
  const registration = eventTypeOf({ saved: props.event, fields }) === 'REGISTRATION';
  const intro = (registration && REGISTRATION_INTRO[step.key]) || INTRO[step.key];
  const savedZone = props.event ? props.venues.find((v) => v.id === props.event?.venueId)?.timezone ?? null : null;
  const zoneNotice = zoneMoveNotice(props.event, savedZone, props.zone);
  const venueEditor = venuesOn ? (
    <VenueStep {...form} orgId={props.orgId} venues={props.venues} onVenueCreated={props.onVenueCreated} zoneNotice={zoneNotice} />
  ) : (
    <LocationStep {...form} orgId={props.orgId} venues={props.venues} onVenueCreated={props.onVenueCreated} onDraft={props.onVenueDraft} zoneNotice={zoneNotice} />
  );
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
      {intro && <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{intro}</p>}
      <div className="mt-6">
        <ErrorSummary ref={summaryRef} errors={summary} onOpenStep={onOpenStep} />
        {readOnly && (
          <p role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            You don&apos;t have access to change this.
          </p>
        )}
        <fieldset disabled={readOnly} className="min-w-0">
          <legend className="sr-only">{step.title}</legend>
          {step.key === 'type' && <TypeStep {...form} locked={!!props.event} />}
          {step.key === 'name' && <NameStep {...form} />}
          {step.key === 'name' && registration && (
            <div className="mt-5">
              <DescribeStep {...form} hint="Shown above the form on the event page: what it is, who it is for, what you look for." />
            </div>
          )}
          {step.key === 'venue' && registration ? (
            <LinkedEventField {...form} orgId={props.orgId}>
              {venueEditor}
            </LinkedEventField>
          ) : (
            step.key === 'venue' && venueEditor
          )}
          {step.key === 'date' && (
            <DateStep
              {...form}
              zone={props.zone}
              orgId={props.orgId}
              venue={props.venues.find((v) => v.id === fields.venueId)}
              onVenueUpdated={props.onVenueCreated}
              // The window is the form's: before the row (both are created on Next) or once the form exists.
              registrationWindow={registration && (!props.event || fields.opensAt !== undefined)}
            />
          )}
          {step.key === 'review' && props.event && <ReviewStep orgId={props.orgId} saved={props.event} {...props.review} />}
          {step.key === 'description' && <DescribeStep {...form} />}
          {step.key === 'image' && props.row && <ImageStep orgId={props.orgId} {...props.row} />}
          {step.key === 'tickets' && props.row && <TicketsStep {...form} orgId={props.orgId} {...props.row} readOnly={readOnly} />}
          {step.key === 'collect-more' && props.event && (
            <CollectMoreStep orgId={props.orgId} eventId={props.event.id} onSaved={props.onAddOnsSaved} />
          )}
          {!step.built && <PendingStep />}
        </fieldset>
        {/* First step, before anything is typed: copying a past live event skips the rest. */}
        {step.key === 'type' && !props.event && !registration && props.orgId && <StartFromPastEvent orgId={props.orgId} />}
      </div>
    </div>
  );
});

export default StepContent;
