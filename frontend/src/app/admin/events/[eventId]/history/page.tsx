// Event workspace › History (spec 048-D): the audit trail filtered to one
// event — the event itself, its tiers, add-ons, forms, applications, map,
// RSVPs and orders. Store admins only (the tab is hidden for other roles and
// GET /admin/audit-log checks the role in the active organization).

'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import EventWorkspaceHeader from '@/components/events/EventWorkspace';
import ActivityLog from '@/app/admin/settings/activity/ActivityLog';

export default function EventHistoryPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { data: session, status } = useSession();
  const isAdmin = ['ADMIN', 'SYSTEM_ADMIN'].includes((session?.user as any)?.role);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <EventWorkspaceHeader eventId={eventId} current="history" title="History" />
      {status === 'authenticated' && !isAdmin ? (
        <p className="py-16 text-center text-gray-600 dark:text-slate-400">Admin role required to view an event’s history.</p>
      ) : (
        <ActivityLog eventId={eventId} showHeading={false} />
      )}
    </div>
  );
}
