'use client';

// Header + tabs shared by the admin applications pages of one event (spec 011).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import api from '@/services/api';

const tab = 'rounded-md px-3 py-1.5 text-sm font-medium';
const activeTab = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
const idleTab = 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800';

export default function ApplicationsHeader({ eventId, title, subtitle }: { eventId: string; title?: string; subtitle?: string }) {
  const pathname = usePathname();
  const [eventName, setEventName] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ name: string }>(`/events/${eventId}`)
      .then((e) => setEventName(e.name))
      .catch(() => setEventName(null));
  }, [eventId]);

  const base = `/admin/events/${eventId}/applications`;
  const onForms = pathname.startsWith(`${base}/forms`);

  return (
    <div className="mb-6">
      <Link href="/admin/events" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">
        ← Back to Events
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title ?? 'Applications'}</h1>
          <p className="text-sm text-gray-600 dark:text-slate-400">{subtitle ?? eventName ?? ''}</p>
        </div>
        <nav aria-label="Applications sections" className="flex gap-1">
          <Link href={base} aria-current={!onForms ? 'page' : undefined} className={`${tab} ${!onForms ? activeTab : idleTab}`}>
            Applications
          </Link>
          <Link href={`${base}/forms`} aria-current={onForms ? 'page' : undefined} className={`${tab} ${onForms ? activeTab : idleTab}`}>
            Forms
          </Link>
          {/* Spec 036: the event-day door surface. Not a tab of this page — it
              is its own phone-first screen, linked from here because this is
              where an organizer is standing the morning of the event. */}
          <Link href={`/admin/events/${eventId}/check-in`} className={`${tab} ${idleTab}`}>
            Door check-in
          </Link>
        </nav>
      </div>
    </div>
  );
}
