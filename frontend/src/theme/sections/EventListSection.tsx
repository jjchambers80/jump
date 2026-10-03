// Theme EventList section (spec 038 §7, locked on the Events page): today's
// list with the organizer's layout, filters, sort and page size.

import EventsListing from '@/components/storefront/EventsListing';
import SectionShell from './SectionShell';
import { t, type SectionContext } from './context';

export interface EventListProps {
  layout?: 'grouped' | 'grid' | 'list';
  columnsDesktop?: number;
  columnsMobile?: number;
  showPrice?: boolean;
  showVenue?: boolean;
  showDateBadge?: boolean;
  categoryFilter?: boolean;
  venueFilter?: boolean;
  sort?: 'date-asc' | 'date-desc';
  pageSize?: number;
  emptyText?: string;
  colorScheme?: string;
  paddingTop?: number;
  sectionWidth?: string;
  paddingBottom?: number;
  ctx: SectionContext;
}

export default function EventListSection({
  layout,
  columnsDesktop,
  columnsMobile,
  showPrice,
  showVenue,
  showDateBadge,
  categoryFilter,
  venueFilter,
  sort,
  pageSize = 24,
  emptyText,
  ctx,
  ...common
}: EventListProps) {
  return (
    <SectionShell type="EventList" props={common}>
      <EventsListing
        as="section"
        organization={ctx.organization}
        events={ctx.resolved.events}
        layout={layout}
        columnsDesktop={columnsDesktop}
        columnsMobile={columnsMobile}
        showPrice={showPrice}
        showVenue={showVenue}
        showDateBadge={showDateBadge}
        categoryFilter={categoryFilter}
        venueFilter={venueFilter}
        sort={sort}
        pageSize={pageSize}
        basePath={ctx.path}
        query={ctx.query}
        headingText={t(ctx, 'events.upcoming')}
        emptyTitle={emptyText || t(ctx, 'events.empty')}
        labels={{ getTickets: t(ctx, 'event.getTickets'), rsvp: t(ctx, 'event.rsvp'), soldOut: t(ctx, 'event.soldOut') }}
      />
    </SectionShell>
  );
}
