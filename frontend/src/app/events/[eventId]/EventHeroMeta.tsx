// Date and venue blocks of the event hero. Times are the venue's wall clock
// with the zone name always shown (spec 033); with an end time the second line
// reads "4:00 – 8:00 PM EDT" (spec 050 §8.2).

import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { formatEventDate } from '@/lib/eventTime';
import { formatEventTimeRange } from '@/lib/eventTimeRange';
import { dateTile } from '@/lib/dateTile';
import Placeholder from './Placeholder';
import type { EventPageEvent } from './eventPage';

const TILE = 'rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm';

export default function EventHeroMeta({ event, preview }: { event: EventPageEvent; preview: boolean }) {
  const zone = event.venue?.timezone;
  const tile = event.date ? dateTile(event.date, zone) : null;

  return (
    <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8">
      {(event.date || preview) && (
        <div id="event-date" className="flex items-center gap-3">
          {tile ? (
            <div aria-hidden className={`flex w-14 shrink-0 flex-col items-center py-1.5 ${TILE}`}>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] opacity-80">{tile.month}</span>
              <span className="text-[22px] font-extrabold leading-none tabular-nums">{tile.day}</span>
            </div>
          ) : (
            <CalendarDays className="h-5 w-5 shrink-0 text-gray-200" aria-hidden />
          )}
          {event.date ? (
            <div className="leading-snug">
              <p className="font-semibold text-white">{formatEventDate(event.date, zone, { weekday: 'long', month: 'long' })}</p>
              <p className="text-sm text-gray-300">{formatEventTimeRange(event.date, event.endDate, zone)}</p>
            </div>
          ) : (
            <p className="leading-snug">
              <Placeholder tone="hero">Add a date</Placeholder>
            </p>
          )}
        </div>
      )}

      {(event.venue || preview) && (
        <div id="event-venue" className="flex items-center gap-3">
          <div aria-hidden className={`flex h-14 w-14 shrink-0 items-center justify-center ${TILE}`}>
            <MapPin className="h-5 w-5" />
          </div>
          {event.venue ? (
            <div className="min-w-0 leading-snug">
              {event.venue.isPublic ? (
                <Link href={`/venues/${event.venue.id}`} className="font-semibold text-white hover:underline">
                  {event.venue.name}
                </Link>
              ) : (
                <p className="font-semibold text-white">{event.venue.name}</p>
              )}
              <p className="text-sm text-gray-300">{event.venue.address}</p>
            </div>
          ) : (
            <p className="leading-snug">
              <Placeholder tone="hero">Add a venue</Placeholder>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
