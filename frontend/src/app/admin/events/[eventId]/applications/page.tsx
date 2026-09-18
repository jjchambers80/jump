// Admin › Event › Applications (spec 011): the event's submissions. Since
// spec 019 the list itself is the shared SubmissionsTable (also mounted
// organization-wide at /admin/participants); this page adds the event header.
'use client';

import { Suspense } from 'react';
import SubmissionsTable from '@/components/applications/SubmissionsTable';
import ApplicationsHeader from './ApplicationsHeader';

export default function ApplicationsListPage({ params }: { params: { eventId: string } }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ApplicationsHeader eventId={params.eventId} />
      <Suspense fallback={null}>
        <SubmissionsTable eventId={params.eventId} />
      </Suspense>
    </div>
  );
}
