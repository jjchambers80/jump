// The organization's event list (today's storefront list). Server-safe: the
// legacy home and the theme EventList section (spec 038) render the same
// markup, so with default settings the themed Events page matches today's.
// Filters and pages are plain links (?category=, ?venue=, ?page=): no script.

import Link from 'next/link';
import type { ElementType } from 'react';
import { CalendarDays } from 'lucide-react';
import EventCard, { type EventSummary } from '@/components/EventCard';
import EventStub, { type EventStubOptions } from '@/components/storefront/EventStub';
import { formatEventDate } from '@/lib/eventTime';
import { dateTile } from '@/lib/dateTile';

export interface EventsListingProps extends EventStubOptions {
  organization: { name: string };
  events: EventSummary[];
  /** `main` on the legacy page; a `section` inside the themed page's own main. */
  as?: ElementType;
  layout?: 'grouped' | 'list' | 'grid';
  columnsDesktop?: number;
  columnsMobile?: number;
  sort?: 'date-asc' | 'date-desc';
  /** Pagination and filters need the current path and query; omitted = everything on one page. */
  pageSize?: number;
  categoryFilter?: boolean;
  venueFilter?: boolean;
  basePath?: string;
  query?: Record<string, string | undefined>;
  headingText?: string;
  emptyTitle?: string;
  emptyText?: string;
}

const GRID_DESKTOP: Record<number, string> = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };
const GRID_MOBILE: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2' };

export default function EventsListing({
  organization,
  events: allEvents,
  as: Tag = 'main',
  layout = 'grouped',
  columnsDesktop = 3,
  columnsMobile = 1,
  sort = 'date-asc',
  pageSize,
  categoryFilter = false,
  venueFilter = false,
  basePath,
  query = {},
  headingText = 'Upcoming events',
  emptyTitle = 'No upcoming events',
  emptyText,
  ...stub
}: EventsListingProps) {
  const categories = [...new Set(allEvents.map((e) => e.category).filter(Boolean) as string[])].sort();
  const venues = [...new Map(allEvents.filter((e) => e.venue).map((e) => [e.venue.id, e.venue.name])).entries()];
  const category = categoryFilter ? query.category : undefined;
  const venue = venueFilter ? query.venue : undefined;
  let events = allEvents.filter((e) => (!category || e.category === category) && (!venue || e.venue?.id === venue));
  if (sort === 'date-desc') events = [...events].reverse();
  const total = events.length;
  const pageCount = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const page = Math.min(pageCount, Math.max(1, Number(query.page) || 1));
  if (pageSize) events = events.slice((page - 1) * pageSize, page * pageSize);
  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...query, ...patch })) if (v) params.set(k, v);
    const qs = params.toString();
    return `${basePath ?? ''}${qs ? `?${qs}` : ''}#events`;
  };
  const chip = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full px-3 text-sm font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
      active ? 'bg-brand text-brand-fg ring-transparent' : 'text-gray-700 ring-gray-300 hover:bg-gray-100 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-800'
    }`;

  return (
    <Tag id="events" className="mx-auto max-w-7xl scroll-mt-6 px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8">
      <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-gray-200 pb-4 dark:border-slate-700 sm:mb-8">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-3xl">{headingText}</h2>
        {total > 0 && (
          <span className="text-sm font-medium tabular-nums text-gray-500 dark:text-slate-400">
            {total} {total === 1 ? 'event' : 'events'}
          </span>
        )}
      </div>

      {basePath && ((categoryFilter && categories.length > 1) || (venueFilter && venues.length > 1)) && (
        <nav aria-label="Filter events" className="mb-6 space-y-2">
          {categoryFilter && categories.length > 1 && (
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link href={href({ category: undefined, page: undefined })} className={chip(!category)} aria-current={!category ? 'true' : undefined}>
                  All categories
                </Link>
              </li>
              {categories.map((c) => (
                <li key={c}>
                  <Link href={href({ category: c, page: undefined })} className={chip(category === c)} aria-current={category === c ? 'true' : undefined}>
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {venueFilter && venues.length > 1 && (
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link href={href({ venue: undefined, page: undefined })} className={chip(!venue)} aria-current={!venue ? 'true' : undefined}>
                  All venues
                </Link>
              </li>
              {venues.map(([id, name]) => (
                <li key={id}>
                  <Link href={href({ venue: id, page: undefined })} className={chip(venue === id)} aria-current={venue === id ? 'true' : undefined}>
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
      )}

      {total === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-16 text-center dark:border-slate-700">
          <CalendarDays className="mx-auto mb-4 h-10 w-10 text-gray-300 dark:text-slate-600" aria-hidden />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300">{emptyTitle}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            {emptyText || `Check back later for new events from ${organization.name}.`}
          </p>
        </div>
      ) : layout === 'grid' ? (
        <ul className={`grid gap-6 ${GRID_MOBILE[columnsMobile] ?? 'grid-cols-1'} sm:grid-cols-2 ${GRID_DESKTOP[columnsDesktop] ?? 'lg:grid-cols-3'}`}>
          {events.map((event) => (
            <li key={event.id}>
              <EventCard event={event} />
            </li>
          ))}
        </ul>
      ) : layout === 'list' ? (
        <ul className="space-y-4">
          {events.map((event, index) => (
            <li key={event.id} className="motion-safe:animate-card-in" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
              <EventStub event={event} {...stub} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-10">
          {groupByMonth(events).map((group) => (
            <section key={group.key} aria-labelledby={`month-${group.key}`} className="lg:grid lg:grid-cols-[9rem_1fr] lg:gap-8">
              <h3
                id={`month-${group.key}`}
                className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-gray-500 dark:text-slate-400 lg:sticky lg:top-6 lg:mb-0 lg:self-start lg:pt-3 lg:text-sm"
              >
                {group.label}
              </h3>
              <ul className="space-y-4">
                {group.events.map(({ event, index }) => (
                  <li key={event.id} className="motion-safe:animate-card-in" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
                    <EventStub event={event} {...stub} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pageCount > 1 && basePath && (
        <nav aria-label="Event pages" className="mt-10 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={href({ page: page === 2 ? undefined : String(page - 1) })} className="font-medium text-brand-link hover:underline">
              ← Earlier
            </Link>
          ) : (
            <span />
          )}
          <span className="text-gray-500 dark:text-slate-400">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={href({ page: String(page + 1) })} className="font-medium text-brand-link hover:underline">
              More events →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </Tag>
  );
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
