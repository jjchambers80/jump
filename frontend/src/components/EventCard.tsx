import Link from 'next/link';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';

export interface EventVenue {
  id: string;
  name: string;
  address: string;
  /** IANA zone the show's wall clock belongs to (spec 033). */
  timezone?: string | null;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface EventSummary {
  id: string;
  slug?: string;
  name: string;
  date: string;
  venue: EventVenue;
  category?: string | null;
  status: string;
  admissionMode: 'TICKETED' | 'RSVP';
  rsvpLimit?: number | null;
  rsvpMaxPartySize?: number;
  priceRange: PriceRange | null;
  availableTickets: number;
}

export function formatPrice(dollars: number): string {
  return `$${Number(dollars).toFixed(2)}`;
}

/**
 * One event in a list. Every caller renders these in a grid
 * (`/events`, `/venues/[venueId]`, the organization storefront), so the card is
 * a full-height flex column with the CTA pinned to the bottom — otherwise a
 * sold-out card, which has no purchase path, would leave a ragged row.
 */
export default function EventCard({ event }: { event: EventSummary }) {
  const href = event.slug ? `/events/${encodeURIComponent(event.slug)}` : `/events/${event.id}`;
  // Spec 033: the venue's zone, never the viewer's, and always with the abbreviation.
  const zone = event.venue?.timezone;
  const formattedDate = formatEventDate(event.date, zone, { weekday: 'long', month: 'long' });
  const formattedTime = formatEventTime(event.date, zone);
  const isRsvp = event.admissionMode === 'RSVP';
  const isSoldOut = !isRsvp && event.availableTickets === 0;
  const isAlmostSoldOut = !isRsvp && event.availableTickets > 0 && event.availableTickets <= 10;
  const isRange = !!event.priceRange && event.priceRange.min !== event.priceRange.max;

  // One shared CTA slot keeps every card in a row the same height. Sold-out
  // events still get a slot so the grid stays aligned, just without the brand fill.
  const ctaLabel = isRsvp ? 'View Details & RSVP' : 'View Details & Purchase';
  const ctaClass = isSoldOut
    ? 'border border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-400'
    : 'bg-brand text-brand-fg group-hover:bg-brand-hover';

  return (
    <Link
      href={href}
      data-testid={`event-card-${event.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/20 dark:focus-visible:ring-offset-slate-900"
    >
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {event.category && (
          <span className="mb-3 inline-flex w-fit items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-gray-600 dark:bg-slate-700 dark:text-slate-300">
            {event.category}
          </span>
        )}

        <h3
          data-testid={`event-card-name-${event.id}`}
          className="text-xl font-bold leading-snug text-gray-900 dark:text-slate-100"
        >
          {event.name}
        </h3>

        <dl className="mt-3 space-y-1.5 text-sm text-gray-600 dark:text-slate-400">
          <div className="flex items-start gap-2">
            <dt className="sr-only">Date</dt>
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <dd>{formattedDate} at {formattedTime}</dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="sr-only">Venue</dt>
            <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <dd>{event.venue?.name || 'TBA'}</dd>
          </div>
        </dl>

        {/* Pinned to the bottom of the card so prices and CTAs line up across a row. */}
        <div className="mt-auto pt-5">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              {isRsvp ? (
                <span className="text-base font-semibold text-brand-link">Free · RSVP</span>
              ) : event.priceRange ? (
                <>
                  {isRange && (
                    <span className="mr-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      From
                    </span>
                  )}
                  <span className="text-2xl font-bold text-brand-link">
                    {formatPrice(event.priceRange.min)}
                  </span>
                  {isRange && (
                    <span className="ml-1 text-sm text-gray-500 dark:text-slate-400">
                      – {formatPrice(event.priceRange.max)}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-gray-500 dark:text-slate-400">No tiers available</span>
              )}
            </div>

            {/* Only scarcity earns a pill; a healthy inventory count stays quiet. */}
            {isSoldOut ? (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 dark:bg-red-900/30 dark:text-red-400">
                Sold Out
              </span>
            ) : isAlmostSoldOut ? (
              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                Almost Sold Out
              </span>
            ) : isRsvp ? (
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">RSVP</span>
            ) : (
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
                {event.availableTickets} tickets available
              </span>
            )}
          </div>

          <div
            className={`mt-4 flex min-h-[2.75rem] w-full items-center justify-center rounded-lg px-4 text-center text-sm font-bold transition-colors duration-200 motion-reduce:transition-none ${ctaClass}`}
          >
            {isSoldOut ? 'View Details' : ctaLabel}
          </div>
        </div>
      </div>
    </Link>
  );
}
