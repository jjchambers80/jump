'use client';

// Business column of the submissions table (spec 019): logo or initial, the
// business name linking to the detail page, the contact, the short id, and
// (phase 3) Checked in / out ticks on APPROVED rows.

import Link from 'next/link';
import { shortId, type ApplicationRow } from '@/lib/applications';

interface BusinessCellProps {
  row: ApplicationRow;
  eventId: string;
  /** Phase 3: toggle a check-in stamp; omitted = ticks hidden. */
  onCheck?: (field: 'checkedIn' | 'checkedOut', value: boolean) => void;
  checkBusy?: boolean;
}

export default function BusinessCell({ row, eventId, onCheck, checkBusy = false }: BusinessCellProps) {
  const initial = (row.businessName || '?').trim().charAt(0).toUpperCase();
  const showChecks = Boolean(onCheck) && row.status === 'APPROVED';
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
        {showChecks && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-700 dark:text-slate-300" data-testid={`application-checkin-${row.id}`}>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={Boolean(row.checkedInAt)} disabled={checkBusy} onChange={(e) => onCheck?.('checkedIn', e.target.checked)} aria-label={`Checked in ${row.businessName}`} />
              Checked in
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={Boolean(row.checkedOutAt)} disabled={checkBusy} onChange={(e) => onCheck?.('checkedOut', e.target.checked)} aria-label={`Checked out ${row.businessName}`} />
              Checked out
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
