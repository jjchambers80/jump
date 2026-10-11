'use client';

// Header shared by the admin applications pages of one event (spec 011): the
// event workspace header (spec 037) plus "Manage forms", which opens the setup
// wizard's application steps (spec 050-P: forms are configured only there).
// Door check-in is a workspace tab of its own.

import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import EventWorkspaceHeader from '@/components/events/EventWorkspace';
import { wizardStepHref } from '@/lib/eventWizard';

export default function ApplicationsHeader({ eventId, title, subtitle }: { eventId: string; title?: string; subtitle?: string }) {
  return (
    <EventWorkspaceHeader
      eventId={eventId}
      current="applications"
      title={title ?? 'Applications'}
      subtitle={subtitle ? <span>{subtitle}</span> : undefined}
      actions={
        <Link
          href={wizardStepHref(eventId, 'vendors')}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          Manage forms
        </Link>
      }
    />
  );
}
