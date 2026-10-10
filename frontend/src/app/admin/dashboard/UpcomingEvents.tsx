// Next five events: date tile and time in the venue's zone (spec 033), how
// full each one is (tickets or RSVPs), and a link into the event.

import Link from 'next/link';
import { CalendarDays, ChevronRight, Plus } from 'lucide-react';
import type { DashboardOverview } from '@/services/adminService';
import { formatEventDate, formatEventTime } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';
import { EventStatusPill } from '@/components/events/EventEditSummary';
import { Panel, PanelLink, Skeleton } from './ui';

type Upcoming = DashboardOverview['upcoming'][number];

function DateTile({ date, zone }: { date: string; zone: string | null }) {
  const tile = dateTile(date, zone);
  return (
    <div aria-hidden="true" className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md border border-gray-200 bg-gray-50 leading-none dark:border-slate-600 dark:bg-slate-900">
      <span className="text-[0.6875rem] font-semibold uppercase text-gray-600 dark:text-slate-300">{tile?.month}</span>
      <span className="mt-0.5 text-lg font-bold tabular-nums text-gray-900 dark:text-white">{tile?.day}</span>
    </div>
  );
}

function FillMeter({ event }: { event: Upcoming }) {
  const noun = event.admissionMode === 'RSVP' ? 'going' : 'sold';
  // Wizard drafts (spec 050) have no capacity yet: say so instead of a meter.
  if (event.capacity === null) {
    return <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">Capacity not set</p>;
  }
  const pct = event.capacity > 0 ? Math.min(100, Math.round((event.sold / event.capacity) * 100)) : 0;
  const label = `${event.sold.toLocaleString('en-US')} of ${event.capacity.toLocaleString('en-US')} ${noun}`;
  return (
    <div className="mt-2 flex items-center gap-2">
      <div
        role="meter"
        aria-label={`${event.name}: ${noun}`}
        aria-valuemin={0}
        aria-valuemax={event.capacity}
        aria-valuenow={Math.min(event.sold, event.capacity)}
        aria-valuetext={`${label}, ${pct}%`}
        className="h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700"
      >
        <div className="h-full rounded-full bg-accent-600 dark:bg-accent-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-slate-300">
        {label} · {pct}%
      </span>
    </div>
  );
}

export default function UpcomingEvents({ events }: { events: Upcoming[] | null }) {
  return (
    <Panel
      id="upcoming-heading"
      title="Upcoming events"
      icon={<CalendarDays className="h-4 w-4 text-gray-500 dark:text-slate-400" aria-hidden="true" />}
      action={<PanelLink href="/admin/events?sort=upcoming" label="View all events" />}
    >
      {!events ? (
        <div className="space-y-4 p-4 sm:px-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-12 w-12" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="px-4 py-8 text-center sm:px-5">
          <p className="text-sm font-medium text-gray-900 dark:text-white">Nothing on the calendar</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Create an event to start selling.</p>
          <Link
            href="/admin/create-event"
            className="mt-4 inline-flex min-h-[2.75rem] items-center gap-2 rounded-md bg-accent-500 px-4 text-sm font-semibold text-gray-950 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create event
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700" data-testid="upcoming-events">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`/admin/events/${event.id}`}
                className="group flex items-center gap-3 px-4 py-3 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 dark:hover:bg-slate-700/50 dark:focus-visible:bg-slate-700/50 sm:px-5"
              >
                <DateTile date={event.date} zone={event.timezone} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-semibold text-gray-900 group-hover:underline dark:text-white">{event.name}</span>
                    {event.status !== 'PUBLISHED' && <EventStatusPill status={event.status} />}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                    {formatEventDate(event.date, event.timezone)} · {formatEventTime(event.date, event.timezone)}
                    {event.venueName && ` · ${event.venueName}`}
                  </p>
                  <FillMeter event={event} />
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
