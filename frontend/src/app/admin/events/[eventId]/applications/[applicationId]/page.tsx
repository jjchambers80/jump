// Admin › Event › Application detail (spec 011). The body is shared with
// Content › Forms submissions (spec 044): components/applications/ApplicationDetail.
'use client';

import ApplicationDetail from '@/components/applications/ApplicationDetail';

export default function ApplicationDetailPage({ params }: { params: { eventId: string; applicationId: string } }) {
  return <ApplicationDetail eventId={params.eventId} applicationId={params.applicationId} />;
}
