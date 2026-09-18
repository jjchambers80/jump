// Admin › Participants (spec 019): every submission across the
// organization's events in one list. The same table renders the per-event
// Applications tab; rows link to the existing per-event detail page.
'use client';

import { Suspense } from 'react';
import SubmissionsTable from '@/components/applications/SubmissionsTable';
import ParticipantsHeader from './ParticipantsHeader';

export default function ParticipantsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ParticipantsHeader />
      <Suspense fallback={null}>
        <SubmissionsTable />
      </Suspense>
    </div>
  );
}
