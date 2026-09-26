'use client';

// Event › Attendees (spec 037 phase 2): the tickets issued for this event —
// lookup, check-in, attendee name, refund — i.e. Orders › Tickets locked to
// the event. Orders › Tickets stays the cross-event lookup.

import { Suspense } from 'react';
import Link from 'next/link';
import { ScanLine } from 'lucide-react';
import EventWorkspaceHeader from '@/components/events/EventWorkspace';
import TicketRowsView from '@/app/admin/orders/TicketRowsView';

export default function EventAttendeesPage({ params }: { params: { eventId: string } }) {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      <EventWorkspaceHeader
        eventId={params.eventId}
        current="attendees"
        title="Attendees"
        actions={
          <Link
            href="/admin/orders/scan"
            className="inline-flex min-h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-semibold text-white hover:bg-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <ScanLine className="h-4 w-4" aria-hidden />
            Check in
          </Link>
        }
      />
      <Suspense fallback={null}>
        <TicketRowsView eventId={params.eventId} />
      </Suspense>
    </div>
  );
}
