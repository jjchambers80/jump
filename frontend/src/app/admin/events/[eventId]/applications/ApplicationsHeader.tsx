'use client';

// Header shared by the admin applications pages of one event (spec 011): the
// event workspace header (spec 037). A registration event (spec 057) is its
// one form: "Registrations" and Edit form. A live event creates registration
// events. Door check-in is a workspace tab of its own.

import Link from 'next/link';
import { Pencil, Plus } from 'lucide-react';
import EventWorkspaceHeader from '@/components/events/EventWorkspace';
import { useCan, useOrg } from '@/components/OrgContext';
import { formFlowHref } from '@/components/event-setup/formFlows';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';

export default function ApplicationsHeader({ eventId, title, subtitle }: { eventId: string; title?: string; subtitle?: string }) {
  const { selectedOrgId } = useOrg();
  const canEdit = useCan('applications.forms');
  const button = `inline-flex min-h-11 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`;
  return (
    <EventWorkspaceHeader
      eventId={eventId}
      current="applications"
      // Spec 057: a registration event's one form takes registrations.
      title={(facts) => title ?? (facts?.type === 'REGISTRATION' ? 'Registrations' : 'Applications')}
      subtitle={subtitle ? <span>{subtitle}</span> : undefined}
      actions={(facts) => {
        if (!canEdit || !facts) return undefined;
        if (facts.type === 'REGISTRATION')
          return (
            <Link href={formFlowHref(eventId, 'registration', { org: selectedOrgId })} className={button}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit form
            </Link>
          );
        // A live event takes new forms as registration events.
        return (
          <>
            <Link href={`/admin/events/new?type=registration&linked=${encodeURIComponent(eventId)}`} className={button}>
              <Plus className="h-4 w-4" aria-hidden />
              Create registration event
            </Link>
          </>
        );
      }}
    />
  );
}
