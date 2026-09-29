// Today's organization home body: the cover with the "Next up" band and the
// events grouped by month. Legacy client page only; the themed Events page
// renders the same two components as the EventsHero and EventList sections.

import type { EventSummary } from '@/components/EventCard';
import EventsCover from './EventsCover';
import EventsListing from './EventsListing';

export default function OrganizationEventsBody({
  organization,
  events,
}: {
  organization: { name: string; coverUrl: string | null };
  events: EventSummary[];
}) {
  return (
    <>
      <EventsCover organization={organization} events={events} />
      <EventsListing organization={organization} events={events} />
    </>
  );
}
