'use client';

// Create event: the setup wizard (spec 050) at steps 1–3, with no row yet.

import { Suspense } from 'react';
import EventSetupPage from '@/components/event-setup/EventSetupPage';

export default function CreateEventPage() {
  return (
    <Suspense fallback={null}>
      <EventSetupPage />
    </Suspense>
  );
}
