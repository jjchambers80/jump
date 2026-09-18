'use client';

// Header + tabs of the Participants section (spec 019): Submissions across
// every event, and (phase 2) Applications — forms and templates.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tab = 'rounded-md px-3 py-1.5 text-sm font-medium';
const activeTab = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
const idleTab = 'text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800';

export default function ParticipantsHeader() {
  const pathname = usePathname();
  const base = '/admin/participants';
  const onApplications = pathname.startsWith(`${base}/applications`) || pathname.startsWith(`${base}/templates`);

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Participants</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400">Vendors, sponsors, press and panelists who applied to your events.</p>
      </div>
      <nav aria-label="Participants sections" className="flex gap-1">
        <Link href={base} aria-current={!onApplications ? 'page' : undefined} className={`${tab} ${!onApplications ? activeTab : idleTab}`}>
          Submissions
        </Link>
        <Link href={`${base}/applications`} aria-current={onApplications ? 'page' : undefined} className={`${tab} ${onApplications ? activeTab : idleTab}`}>
          Applications
        </Link>
      </nav>
    </div>
  );
}
