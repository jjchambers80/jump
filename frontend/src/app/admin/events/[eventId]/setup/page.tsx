'use client';

// The setup wizard on an existing event (spec 050 §8.1): `?step=<key>`, or the
// resume point when it is missing. Dark until NEXT_PUBLIC_EVENT_WIZARD_ENABLED.

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import EventSetupPage from '@/components/event-setup/EventSetupPage';
import { EVENT_WIZARD_ENABLED } from '@/lib/eventWizard';

export default function EventSetupRoute({ params }: { params: { eventId: string } }) {
  if (!EVENT_WIZARD_ENABLED) notFound();
  return (
    <Suspense fallback={null}>
      <EventSetupPage eventId={params.eventId} />
    </Suspense>
  );
}
