// The organization cover with the "Next up" band (today's storefront hero).
// Server-safe: the legacy home and the theme EventsHero section (spec 038)
// render the same markup, so the themed Events page matches today's.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { EventSummary } from '@/components/EventCard';
import { resolveAssetUrl } from '@/lib/assets';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';

const HEIGHTS = {
  small: 'aspect-[21/9] sm:aspect-[3/1] lg:aspect-[4/1]',
  medium: 'aspect-[16/9] sm:aspect-[21/9] lg:aspect-[5/2]',
  large: 'aspect-[4/3] sm:aspect-[16/9] lg:aspect-[2/1]',
} as const;

export interface EventsCoverProps {
  organization: { name: string; coverUrl: string | null };
  events: EventSummary[];
  /** Theme EventsHero settings; defaults are today's cover. */
  imageUrl?: string | null;
  imageAlt?: string | null;
  showNextEvent?: boolean;
  height?: keyof typeof HEIGHTS;
  labels?: { getTickets?: string; rsvp?: string };
}

export default function EventsCover({
  organization,
  events,
  imageUrl,
  imageAlt,
  showNextEvent = true,
  height = 'medium',
  labels = {},
}: EventsCoverProps) {
  const coverSrc = resolveAssetUrl(imageUrl ?? organization.coverUrl);
  if (!coverSrc) return null;
  const nextEvent = events[0];
  const alt = imageAlt ?? `${organization.name} cover`;
  return (
    <div className="mx-auto max-w-7xl sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <div className={`relative overflow-hidden bg-gray-200 dark:bg-slate-800 sm:rounded-3xl ${HEIGHTS[height]}`}>
        <img
          src={coverSrc}
          alt={alt}
          className="h-full w-full object-cover"
        />
        {showNextEvent && nextEvent && (
          <>
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent"
            />
            <Link
              href={eventHref(nextEvent)}
              className="group absolute inset-0 flex flex-wrap items-end justify-between gap-3 p-4 outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-white/80 sm:rounded-3xl sm:p-8"
            >
              <div className="min-w-0 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">Next up</p>
                <p className="mt-1 max-w-2xl text-xl font-bold leading-tight tracking-tight group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4 sm:text-3xl">
                  {nextEvent.name}
                </p>
                <p className="mt-1 text-sm font-medium text-white/85">
                  {formatEventDate(nextEvent.date, nextEvent.venue?.timezone, { weekday: 'long', month: 'long' })}
                  {' · '}
                  {formatEventTime(nextEvent.date, nextEvent.venue?.timezone)}
                </p>
              </div>
              <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm transition group-hover:bg-gray-100 sm:inline-flex">
                {nextEvent.admissionMode === 'RSVP' ? (labels.rsvp ?? 'RSVP') : (labels.getTickets ?? 'Get tickets')}
                <ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function eventHref(event: EventSummary) {
  return event.slug ? `/events/${encodeURIComponent(event.slug)}` : `/events/${event.id}`;
}
