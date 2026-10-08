'use client';

// Header shared by the admin applications pages of one event (spec 011): the
// event workspace header (spec 037) plus the Queue / Forms switch. Door
// check-in is a workspace tab of its own.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import EventWorkspaceHeader from '@/components/events/EventWorkspace';

const tab = 'rounded-md px-3 py-1.5 text-sm font-medium';
const activeTab = 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300';
const idleTab = 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800';

export default function ApplicationsHeader({ eventId, title, subtitle }: { eventId: string; title?: string; subtitle?: string }) {
  const pathname = usePathname();
  const base = `/admin/events/${eventId}/applications`;
  const onForms = pathname.startsWith(`${base}/forms`);

  return (
    <EventWorkspaceHeader
      eventId={eventId}
      current="applications"
      title={title ?? 'Applications'}
      subtitle={subtitle ? <span>{subtitle}</span> : undefined}
      actions={
        <nav aria-label="Applications sections" className="flex gap-1">
          <Link href={base} aria-current={!onForms ? 'page' : undefined} className={`${tab} ${!onForms ? activeTab : idleTab}`}>
            Queue
          </Link>
          <Link href={`${base}/forms`} aria-current={onForms ? 'page' : undefined} className={`${tab} ${onForms ? activeTab : idleTab}`}>
            Forms
          </Link>
        </nav>
      }
    />
  );
}
