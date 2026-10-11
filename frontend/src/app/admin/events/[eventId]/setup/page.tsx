'use client';

// The setup wizard on an existing event (spec 050 §8.1): `?step=<key>`, or the
// resume point when it is missing.

import { Suspense } from 'react';
import EventSetupPage from '@/components/event-setup/EventSetupPage';
import OrgFromUrlGate from '@/components/event-setup/OrgFromUrlGate';

export default function EventSetupRoute({ params }: { params: { eventId: string } }) {
  return (
    <Suspense fallback={null}>
      <OrgFromUrlGate>
        <EventSetupPage eventId={params.eventId} />
      </OrgFromUrlGate>
    </Suspense>
  );
}
