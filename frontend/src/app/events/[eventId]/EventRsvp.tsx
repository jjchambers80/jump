// RSVP mode (spec 034): the pass (first on phones, sticky beside "About" on
// desktop). RSVP ≠ Order (gotcha 29): no tiers, no cart. In `preview` the
// form shows but never submits (RsvpPass).
// Spec 047 D1 adds its "Give to {Org}" RSVP entry here (inert in preview).

import RsvpPass from './RsvpPass';
import EventAbout from './EventAbout';
import type { LegalVersions } from '@/lib/legal';
import type { EventPageEvent } from './eventPage';

interface EventRsvpProps {
  event: EventPageEvent;
  isPastEvent: boolean;
  preview: boolean;
  legalVersions: LegalVersions | null;
  onLegalStale?: () => void;
  onSubmitted?: () => void;
}

export default function EventRsvp({ event, isPastEvent, preview, legalVersions, onLegalStale, onSubmitted }: EventRsvpProps) {
  const showAbout = !!event.description || preview;
  return (
    <div className={showAbout ? 'grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12' : 'mx-auto max-w-md'}>
      {/* Pass first on mobile: it is the one thing to do here */}
      <div id="rsvp-pass" className="scroll-mt-6 lg:order-2">
        <div className="lg:sticky lg:top-6">
          <RsvpPass
            event={{ ...event, date: event.date ?? '' }}
            isPastEvent={isPastEvent}
            preview={preview}
            legalVersions={legalVersions}
            onLegalStale={onLegalStale ?? (() => {})}
            onSubmitted={onSubmitted ?? (() => {})}
          />
        </div>
      </div>

      {showAbout && <EventAbout description={event.description} className="lg:order-1 lg:pt-1" />}
    </div>
  );
}
