// Today's organization home body (cover + "Next up" overlay + events grouped
// by month in each venue's zone). Server-safe: rendered by the client
// OrganizationStorefront (legacy) and by the themed server route (spec 038
// 038B) until card 038C turns it into the EventsHero and EventList sections.

import Link from 'next/link';
import { ArrowRight, CalendarDays } from 'lucide-react';
import type { EventSummary } from '@/components/EventCard';
import EventStub from '@/components/storefront/EventStub';
import { resolveAssetUrl } from '@/lib/assets';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';

export default function OrganizationEventsBody({
  organization,
  events,
}: {
  organization: { name: string; coverUrl: string | null };
  events: EventSummary[];
}) {
  const coverSrc = resolveAssetUrl(organization.coverUrl);
  const hasCover = Boolean(coverSrc);
  const nextEvent = events[0];
  const groups = groupByMonth(events);

  return (
    <>
      {hasCover && (
        <div className="mx-auto max-w-7xl sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
          <div className="relative aspect-[16/9] overflow-hidden bg-gray-200 dark:bg-slate-800 sm:aspect-[21/9] sm:rounded-3xl lg:aspect-[5/2]">
            <img
              src={coverSrc!}
              alt={`${organization.name} cover`}
              className="h-full w-full object-cover"
            />
            {nextEvent && (
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
                    {nextEvent.admissionMode === 'RSVP' ? 'RSVP' : 'Get tickets'}
                    <ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      <main
        id="events"
        className="mx-auto max-w-7xl scroll-mt-6 px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8"
      >
        <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-gray-200 pb-4 dark:border-slate-700 sm:mb-8">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-3xl">
            Upcoming events
          </h2>
          {events.length > 0 && (
            <span className="text-sm font-medium tabular-nums text-gray-500 dark:text-slate-400">
              {events.length} {events.length === 1 ? 'event' : 'events'}
            </span>
          )}
        </div>

        {events.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-16 text-center dark:border-slate-700">
            <CalendarDays className="mx-auto mb-4 h-10 w-10 text-gray-300 dark:text-slate-600" aria-hidden />
            <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300">No upcoming events</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              Check back later for new events from {organization.name}.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <section
                key={group.key}
                aria-labelledby={`month-${group.key}`}
                className="lg:grid lg:grid-cols-[9rem_1fr] lg:gap-8"
              >
                <h3
                  id={`month-${group.key}`}
                  className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-gray-500 dark:text-slate-400 lg:sticky lg:top-6 lg:mb-0 lg:self-start lg:pt-3 lg:text-sm"
                >
                  {group.label}
                </h3>
                <ul className="space-y-4">
                  {group.events.map(({ event, index }) => (
                    <li
                      key={event.id}
                      className="motion-safe:animate-card-in"
                      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                    >
                      <EventStub event={event} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function eventHref(event: EventSummary) {
  return event.slug ? `/events/${encodeURIComponent(event.slug)}` : `/events/${event.id}`;
}

/** Events bucketed by month in each venue's own zone (spec 033), in list order. */
function groupByMonth(events: EventSummary[]) {
  const currentYear = new Date().getFullYear().toString();
  const groups: { key: string; label: string; events: { event: EventSummary; index: number }[] }[] = [];
  events.forEach((event, index) => {
    const tile = dateTile(event.date, event.venue?.timezone);
    const key = tile ? `${tile.year}-${tile.month}` : 'tba';
    const month = formatEventDate(event.date, event.venue?.timezone, { month: 'long' }).match(/^\w+, (\w+) /)?.[1];
    const label = tile && month ? (tile.year === currentYear ? month : `${month} ${tile.year}`) : 'Date TBA';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push({ event, index });
    else groups.push({ key, label, events: [{ event, index }] });
  });
  return groups;
}

