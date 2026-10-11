'use client';

// "Add to lineup" on an approved special guest application (spec 050 §7.6,
// card 050-Q): copies the profile (name, bio, first photo, links) into the
// event's guest lineup. Edits to the lineup row happen in the event setup
// wizard's Special guests step; this button only creates it once.

import { useState } from 'react';
import Link from 'next/link';
import { Check, UserPlus } from 'lucide-react';
import api from '@/services/api';
import { describeError } from '@/app/admin/events/[eventId]/applications/useApplicationsApi';

export default function AddToLineup({ eventId, applicationId, guestId, onAdded }: { eventId: string; applicationId: string; guestId: string | null; onAdded: (guestId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editHref = `/admin/events/${eventId}/setup?step=special-guests`;

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const guest = await api.post<{ id: string }>(`/admin/events/${eventId}/applications/${applicationId}/add-to-lineup`, {});
      onAdded(guest.id);
    } catch (err) {
      setError(describeError(err, 'Could not add this guest to the lineup'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-200 pt-4 dark:border-slate-700" data-testid="add-to-lineup">
      {guestId ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-slate-300" role="status">
          <Check className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden />
          In the event lineup.
          <Link href={editHref} className="font-medium text-blue-700 underline hover:text-blue-800 dark:text-blue-300">
            Edit lineup
          </Link>
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            {busy ? 'Adding…' : 'Add to lineup'}
          </button>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Shows this guest on the event page with their name, bio, first photo and links.</p>
        </>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
