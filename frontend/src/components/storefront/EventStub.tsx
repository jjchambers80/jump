import Link from 'next/link';
import { ArrowRight, Clock, MapPin } from 'lucide-react';
import { formatEventTime } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';
import { formatPrice, type EventSummary } from '@/components/EventCard';

// Prices are text-xl bold (WCAG large text): brand-link-dark is derived against
// the slate-900 page, and the stub sits on slate-800.

/** Scarcity only once it means something: the last 10 tickets. */
const SCARCE_AT = 10;

/**
 * One event on the organization storefront, drawn as a ticket stub: a
 * brand-colored date tile torn from the details by a notched perforation
 * (`.event-stub` in globals.css). Same language as the RSVP pass on the
 * event page, so the storefront and the event read as one set.
 */
export default function EventStub({ event }: { event: EventSummary }) {
  const href = event.slug ? `/events/${encodeURIComponent(event.slug)}` : `/events/${event.id}`;
  // Spec 033: the venue's zone, never the viewer's, and always with the abbreviation.
  const zone = event.venue?.timezone;
  const tile = dateTile(event.date, zone);
  const time = formatEventTime(event.date, zone);
  const isRsvp = event.admissionMode === 'RSVP';
  const isSoldOut = !isRsvp && event.availableTickets === 0;
  const isScarce = !isRsvp && event.availableTickets > 0 && event.availableTickets <= SCARCE_AT;

  return (
    <div className="event-stub-shadow">
      <Link
        href={href}
        data-testid={`event-card-${event.id}`}
        className="event-stub group flex min-h-[8.5rem] overflow-hidden rounded-2xl bg-white outline-none ring-1 ring-inset ring-gray-200 focus-visible:ring-2 focus-visible:ring-brand dark:bg-slate-800 dark:ring-slate-700"
      >
        {/* Date tile */}
        <div
          className={`flex w-20 shrink-0 flex-col items-center justify-center px-2 py-4 sm:w-28 ${
            isSoldOut
              ? 'bg-gray-100 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300'
              : 'bg-brand text-brand-fg'
          }`}
        >
          {tile && (
            <>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em]">{tile.month}</span>
              <span className="text-[34px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[42px]">
                {tile.day}
              </span>
              <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
                {tile.weekday}
              </span>
            </>
          )}
        </div>

        {/* Perforation */}
        <div aria-hidden className="my-3 border-l-2 border-dashed border-gray-200 dark:border-slate-600" />

        {/* Details */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5 sm:pl-6">
          <div className="min-w-0 flex-1">
            {event.category && (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">
                {event.category}
              </p>
            )}
            <h3
              data-testid={`event-card-name-${event.id}`}
              className="text-lg font-bold leading-snug tracking-tight text-gray-900 group-hover:text-brand-link dark:text-slate-100 sm:text-xl"
            >
              {event.name}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {time}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{event.venue?.name || 'TBA'}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center sm:gap-2 sm:text-right">
            <div className="leading-tight">
              {isRsvp ? (
                <span className="text-xl font-bold text-brand-link">Free</span>
              ) : event.priceRange ? (
                <span className="whitespace-nowrap">
                  {event.priceRange.min !== event.priceRange.max && (
                    <span className="mr-1 text-xs font-medium text-gray-500 dark:text-slate-400">From</span>
                  )}
                  <span className="text-xl font-bold tabular-nums text-brand-link">
                    {formatPrice(event.priceRange.min)}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-gray-500 dark:text-slate-400">Tickets soon</span>
              )}
              {isScarce && (
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Only {event.availableTickets} left
                </p>
              )}
            </div>

            {isSoldOut ? (
              <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                Sold out
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors group-hover:bg-brand-hover">
                {isRsvp ? 'RSVP' : 'Get tickets'}
                <ArrowRight
                  className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
