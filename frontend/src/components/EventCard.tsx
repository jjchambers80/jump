import Link from 'next/link';
import { ArrowUpRight, Clock, MapPin } from 'lucide-react';
import { formatEventTime } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';
import { imageVariantUrl } from '@/lib/assets';

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
  /** Event image (Media section); the `original` serving URL. */
  imageUrl?: string | null;
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

/** Scarcity only once it means something: the last 10 tickets. */
const SCARCE_AT = 10;

/**
 * One event as a poster card: the event image fitted whole over a blurred
 * copy of itself (the hero's treatment, so flyers of any shape read), a
 * calendar tile, then a ticket stub torn off by a notched perforation
 * (`.ticket-notch-*` in globals.css) with the price and the call to action.
 */
export default function EventCard({ event }: { event: EventSummary }) {
  const href = event.slug ? `/events/${encodeURIComponent(event.slug)}` : `/events/${event.id}`;
  // Spec 033: the venue's zone, never the viewer's, and always with the abbreviation.
  const zone = event.venue?.timezone;
  const tile = dateTile(event.date, zone);
  const time = formatEventTime(event.date, zone);
  const image = imageVariantUrl(event.imageUrl, 'hero');
  const isRsvp = event.admissionMode === 'RSVP';
  const isSoldOut = !isRsvp && event.availableTickets === 0;
  const isScarce = !isRsvp && event.availableTickets > 0 && event.availableTickets <= SCARCE_AT;
  const cta = isRsvp ? 'View Details & RSVP' : isSoldOut ? 'View Details' : 'View Details & Purchase';

  return (
    <div className="event-stub-shadow h-full">
      <Link
        href={href}
        data-testid={`event-card-${event.id}`}
        className="group flex h-full flex-col rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 dark:focus-visible:ring-offset-slate-900"
      >
        {/* Poster */}
        <div className="ticket-notch-bottom relative isolate aspect-[16/10] overflow-hidden rounded-t-3xl bg-slate-900">
          {image ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt=""
                aria-hidden
                loading="lazy"
                className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-70 blur-2xl saturate-150"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt=""
                loading="lazy"
                className="absolute inset-0 -z-10 h-full w-full object-contain transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
              />
            </>
          ) : (
            <div
              aria-hidden
              className="absolute inset-0 -z-10 flex items-end justify-end bg-brand p-5 text-brand-fg [background-image:repeating-linear-gradient(135deg,rgb(255_255_255/0.08)_0_1px,transparent_1px_10px)]"
            >
              <span className="text-[7rem] font-black leading-[0.75] tracking-tighter opacity-25">
                {event.name.trim().charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-24 bg-gradient-to-b from-black/45 to-transparent" />

          {tile && (
            <div className="absolute left-4 top-4 flex w-14 flex-col items-center rounded-2xl bg-white/95 py-2 text-gray-900 shadow-lg shadow-black/20 backdrop-blur dark:bg-slate-900/90 dark:text-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-link">{tile.month}</span>
              <span className="text-2xl font-extrabold leading-none tracking-tight tabular-nums">{tile.day}</span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-slate-400">
                {tile.weekday}
              </span>
            </div>
          )}

          {event.category && (
            <span className="absolute right-4 top-4 max-w-[55%] truncate rounded-full bg-black/45 px-3 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-md">
              {event.category}
            </span>
          )}

          {(isSoldOut || isScarce) && (
            <span
              className={`absolute bottom-4 left-4 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide shadow ${
                isSoldOut ? 'bg-gray-900/85 text-white' : 'bg-amber-400 text-amber-950'
              }`}
            >
              {isSoldOut ? 'Sold Out' : 'Almost Sold Out'}
            </span>
          )}
        </div>

        {/* Stub */}
        <div className="ticket-notch-top relative flex flex-1 flex-col rounded-b-3xl bg-white p-5 pt-6 dark:bg-slate-800 sm:p-6">
          <div aria-hidden className="absolute inset-x-5 top-0 border-t-2 border-dashed border-gray-200 dark:border-slate-600" />

          <h3
            data-testid={`event-card-name-${event.id}`}
            className="line-clamp-2 text-xl font-bold leading-snug tracking-tight text-gray-900 dark:text-slate-100"
          >
            {event.name}
          </h3>

          <ul className="mt-3 space-y-1.5 text-sm text-gray-600 dark:text-slate-400">
            <li className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden />
              <span>
                {tile ? `${tile.weekday}, ${tile.month} ${tile.day}` : ''}
                {tile ? ' · ' : ''}
                {time}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden />
              <span className="truncate">{event.venue?.name || 'TBA'}</span>
            </li>
          </ul>

          <div className="mt-auto flex items-end justify-between gap-3 pt-5">
            <div className="min-w-0">
              {isRsvp ? (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Free</p>
                  <p className="text-xl font-bold text-brand-link">RSVP</p>
                </>
              ) : event.priceRange ? (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    {event.priceRange.min !== event.priceRange.max ? 'From' : 'Price'}
                  </p>
                  <p className="flex items-baseline gap-1 whitespace-nowrap">
                    <span className="text-2xl font-extrabold tracking-tight text-brand-link tabular-nums">
                      {formatPrice(event.priceRange.min)}
                    </span>
                    {event.priceRange.min !== event.priceRange.max && (
                      <span className="text-sm text-gray-500 dark:text-slate-400">– {formatPrice(event.priceRange.max)}</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500 dark:text-slate-400">No tiers available</p>
              )}
              {!isRsvp && !isSoldOut && event.priceRange && (
                <p className="mt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  {event.availableTickets} tickets available
                </p>
              )}
            </div>
          </div>

          <span
            className={`mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-bold transition-colors duration-200 ${
              isSoldOut
                ? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
                : 'bg-brand text-brand-fg group-hover:bg-brand-hover'
            }`}
          >
            {cta}
            <ArrowUpRight
              className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        </div>
      </Link>
    </div>
  );
}
