// Spec 054: what a cancelled event's page shows in place of tickets, RSVP and
// the cart. Old links and emails land here instead of a 404.

import { CalendarX2 } from 'lucide-react';
import type { EventPageEvent, EventPageOrg } from './eventPage';

export default function EventCancelledNotice({ event, org }: { event: EventPageEvent; org: EventPageOrg }) {
  const host = org.name || 'The organizer';
  return (
    <section role="status" aria-labelledby="event-cancelled-heading" className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <CalendarX2 className="mt-0.5 h-6 w-6 shrink-0 text-gray-500 dark:text-slate-400" aria-hidden />
        <div>
          <h2 id="event-cancelled-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
            This event was cancelled
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
            {host} cancelled {event.name || 'this event'}. Tickets and applications are closed.
            {event.admissionMode === 'RSVP' ? ' Your RSVP has been cancelled.' : ' If you have an order, contact the organizer about it.'}
          </p>
        </div>
      </div>
    </section>
  );
}
