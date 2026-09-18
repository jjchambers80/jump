'use client';

// Business column of the submissions table (spec 019): logo or initial, the
// business name linking to the detail page, the contact, and the short id.

import Link from 'next/link';
import { shortId, type ApplicationRow } from '@/lib/applications';

export default function BusinessCell({ row, eventId }: { row: ApplicationRow; eventId: string }) {
  const initial = (row.businessName || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-start gap-3">
      {row.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.logoUrl} alt="" className="h-10 w-10 flex-none rounded-md object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-gray-100 text-sm font-semibold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
          {initial}
        </span>
      )}
      <div className="min-w-0">
        <Link href={`/admin/events/${eventId}/applications/${row.id}`} className="font-medium text-gray-900 hover:underline dark:text-white">
          {row.businessName}
        </Link>
        <div className="text-xs text-gray-600 dark:text-slate-400">
          {row.contact.firstName} {row.contact.lastName} · {row.contact.email}
        </div>
        <div className="text-xs text-gray-500 dark:text-slate-500">ID: {row.shortId ?? shortId(row.id)}</div>
      </div>
    </div>
  );
}
