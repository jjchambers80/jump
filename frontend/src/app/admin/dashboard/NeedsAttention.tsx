// What the organizer should do next: upcoming drafts to publish and
// applications waiting for a decision. Each row says why and links to the
// place to act; drafts can be published from here.

import Link from 'next/link';
import { BellRing, CheckCircle2, ClipboardList, FilePen } from 'lucide-react';
import type { DashboardOverview } from '@/services/adminService';
import { formatEventDate } from '@/lib/eventTime';
import { Panel, Skeleton } from './ui';

type Attention = DashboardOverview['attention'];

function reviewHref(row: Attention['applicationsToReview'][number]) {
  return row.eventId
    ? `/admin/events/${row.eventId}/applications?status=SUBMITTED`
    : `/admin/content/forms/${row.formId}?status=SUBMITTED`;
}

const rowLink =
  'min-w-0 flex-1 rounded-sm text-sm font-medium text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-white';

export default function NeedsAttention({
  attention,
  publishingId,
  onPublish,
}: {
  attention: Attention | null;
  publishingId: string | null;
  onPublish: (eventId: string) => void;
}) {
  const count = attention ? attention.draftEvents.length + attention.applicationsToReview.length : 0;

  return (
    <Panel
      id="attention-heading"
      title="Needs attention"
      icon={<BellRing className="h-4 w-4 text-gray-500 dark:text-slate-400" aria-hidden="true" />}
      action={
        count > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            {count} <span className="sr-only">{count === 1 ? 'item' : 'items'}</span>
          </span>
        ) : undefined
      }
    >
      {!attention ? (
        <div className="space-y-3 p-4 sm:px-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : count === 0 ? (
        <p className="flex items-center gap-2 px-4 py-5 text-sm text-gray-600 dark:text-slate-300 sm:px-5" data-testid="attention-clear">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          You’re all caught up.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700" data-testid="attention-list">
          {attention.applicationsToReview.map((row) => (
            <li key={`${row.eventId ?? row.formId}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <Link href={reviewHref(row)} className={rowLink}>
                  {row.count} {row.count === 1 ? 'application' : 'applications'} to review
                </Link>
                <p className="truncate text-xs text-gray-500 dark:text-slate-400">{row.name}</p>
              </div>
            </li>
          ))}
          {attention.draftEvents.map((event) => (
            <li key={event.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <FilePen className="h-5 w-5 shrink-0 text-gray-500 dark:text-slate-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <Link href={`/admin/events/${event.id}`} className={`${rowLink} block truncate`}>
                  {event.name}
                </Link>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Draft · {formatEventDate(event.date, event.timezone)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onPublish(event.id)}
                disabled={publishingId === event.id}
                aria-label={`Publish ${event.name}`}
                className="min-h-[2.75rem] shrink-0 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {publishingId === event.id ? 'Publishing…' : 'Publish'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
