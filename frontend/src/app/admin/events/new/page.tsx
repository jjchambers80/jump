'use client';

// Create event. With NEXT_PUBLIC_EVENT_WIZARD_ENABLED the setup wizard (spec
// 050) opens at steps 1–3 with no row yet; otherwise today's form, untouched.

import { Suspense } from 'react';
import EventSetupPage from '@/components/event-setup/EventSetupPage';
import { EVENT_WIZARD_ENABLED } from '@/lib/eventWizard';
import LegacyCreateEventPage from './LegacyCreateEventPage';

export default function CreateEventPage() {
  if (!EVENT_WIZARD_ENABLED) return <LegacyCreateEventPage />;
  return (
    <Suspense fallback={null}>
      <EventSetupPage />
    </Suspense>
  );
}
