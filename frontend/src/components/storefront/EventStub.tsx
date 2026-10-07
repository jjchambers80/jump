import Link from 'next/link';
import { ArrowRight, Clock, MapPin } from 'lucide-react';
import { formatEventTime } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';
import { formatPrice, type EventSummary } from '@/components/EventCard';

// One brand fill per card: the CTA. The date tile is a recessed neutral surface
// with only the month in brand-link, and the price is plain text, so nothing
// competes with the button. brand-link-dark is derived against slate-800
// (color.ts), so the month keeps AA on the slate-900 tile and the card; the
// tile's inset shadow redraws the card's slate-700 ring, which it covers.

/** Scarcity only once it means something: the last 10 tickets. */
const SCARCE_AT = 10;

/**
 * One event on the organization storefront, drawn as a ticket stub: a
 * date tile torn from the details by a notched perforation
 * (`.event-stub` in globals.css). Same language as the RSVP pass on the
 * event page, so the storefront and the event read as one set.
 */
export interface EventStubOptions {
  /** Theme EventList settings (spec 038); every one defaults to today's stub. */
  showPrice?: boolean;
  showVenue?: boolean;
  showDateBadge?: boolean;
  /** Default theme content (spec 038 D15). */
  labels?: { getTickets?: string; rsvp?: string; soldOut?: string };
}

export default function EventStub({
  event,
  showPrice = true,
  showVenue = true,
  showDateBadge = true,
  labels = {},
}: { event: EventSummary } & EventStubOptions) {
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
        {showDateBadge && (
          <div
            className={`flex w-20 shrink-0 flex-col items-center justify-center bg-white px-2 py-4 dark:bg-slate-900 dark:shadow-[inset_1px_0_0_#334155,inset_0_1px_0_#334155,inset_0_-1px_0_#334155] sm:w-28 ${
              isSoldOut ? 'text-gray-500 dark:text-slate-400' : 'text-gray-900 dark:text-slate-100'
            }`}
          >
            {tile && (
              <>
                <span
                  className={`text-[11px] font-bold uppercase tracking-[0.18em] ${
                    isSoldOut ? '' : 'text-brand-link'
                  }`}
                >
                  {tile.month}
                </span>
                <span className="text-[34px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[42px]">
                  {tile.day}
                </span>
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">
                  {tile.weekday}
                </span>
              </>
            )}
          </div>
        )}

        {/* Perforation */}
        {showDateBadge && (
          <div aria-hidden className="my-3 border-l-2 border-dashed border-gray-200 dark:border-slate-600" />
        )}

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
              {showVenue && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{event.venue?.name || 'TBA'}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center sm:gap-2 sm:text-right">
            <div className="leading-tight">
              {!showPrice ? null : isRsvp ? (
                <span className="text-xl font-bold text-gray-900 dark:text-slate-100">Free</span>
              ) : event.priceRange ? (
                <span className="whitespace-nowrap">
                  {event.priceRange.min !== event.priceRange.max && (
                    <span className="mr-1 text-xs font-medium text-gray-500 dark:text-slate-400">From</span>
                  )}
                  <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-slate-100">
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
                {labels.soldOut ?? 'Sold out'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors group-hover:bg-brand-hover">
                {isRsvp ? (labels.rsvp ?? 'RSVP') : (labels.getTickets ?? 'Get tickets')}
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
