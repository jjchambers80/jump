// Theme UpcomingEvents section (spec 038 §7, card 038S): the next few
// published events as ticket stubs, cards or a swipeable row. The carousel
// never moves on its own, so it needs no pause control.

import Link from 'next/link';
import EventCard from '@/components/EventCard';
import EventStub from '@/components/storefront/EventStub';
import { shortenHref } from '../links';
import SectionShell from './SectionShell';
import { t, type SectionContext } from './context';

export interface UpcomingEventsProps {
  id: string;
  heading?: string;
  count?: number;
  layout?: 'grid' | 'list' | 'carousel';
  category?: string;
  showViewAll?: boolean;
  colorScheme?: string;
  paddingTop?: number;
  paddingBottom?: number;
  ctx: SectionContext;
}

export default function UpcomingEventsSection({
  id,
  heading,
  count = 6,
  layout = 'grid',
  category = '',
  showViewAll = true,
  ctx,
  ...common
}: UpcomingEventsProps) {
  const now = Date.now();
  const events = ctx.resolved.events
    .filter((e) => new Date(e.date).getTime() >= now)
    .filter((e) => !category || e.category?.toLowerCase() === category.toLowerCase())
    .slice(0, Math.min(12, Math.max(1, count)));
  const title = heading || t(ctx, 'events.upcoming');
  const headingId = `upcoming-${id}`;
  const allHref = shortenHref(`/organizations/${ctx.organization.slug}/events`, ctx);
  const labels = { getTickets: t(ctx, 'event.getTickets'), rsvp: t(ctx, 'event.rsvp'), soldOut: t(ctx, 'event.soldOut') };

  return (
    <SectionShell type="UpcomingEvents" props={common}>
      <section aria-labelledby={headingId} className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 id={headingId} className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-3xl">
            {title}
          </h2>
          {showViewAll && (
            <Link href={allHref} className="shrink-0 text-sm font-semibold text-brand-link hover:underline">
              {t(ctx, 'events.viewAll')}
            </Link>
          )}
        </div>
        {events.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-10 text-center text-gray-600 dark:border-slate-700 dark:text-slate-400">
            {t(ctx, 'events.empty')}
          </p>
        ) : layout === 'list' ? (
          <ul className="space-y-4">
            {events.map((event) => (
              <li key={event.id}>
                <EventStub event={event} labels={labels} />
              </li>
            ))}
          </ul>
        ) : layout === 'carousel' ? (
          <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label={title}>
            {events.map((event) => (
              <li key={event.id} className="w-[85%] shrink-0 snap-start sm:w-[45%] lg:w-[31%]">
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </SectionShell>
  );
}
