'use client';

// Erase customer data (spec 040 PA-18): the staff side of "Delete my data",
// for requests that arrive by email. Shows what erasing does, refuses while a
// blocker stands, needs the word ERASE typed and a fresh step-up proof, then
// anonymizes at once (no grace period). ADMIN only on the backend.

import { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import { api } from '@/services/api';
import { formatEventDateTime } from '@/lib/eventTime';
import { isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';

interface ErasurePreview {
  ticketsToVoid: { id: string; ticketNumber: number; eventName: string; eventDate: string; eventTimezone: string | null }[];
  applicationsToWithdraw: { id: string; formName: string; eventName: string }[];
  rsvpsToCancel: { id: string; eventName: string }[];
  blockers: { code: string; message: string }[];
}

export default function EraseCustomerDialog({
  contactId,
  customerName,
  onClose,
  onErased,
}: {
  contactId: string;
  customerName: string;
  onClose: () => void;
  onErased: () => void;
}) {
  const { withReauth } = useReauth();
  const [preview, setPreview] = useState<ErasurePreview | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ErasurePreview>(`/admin/customers/${contactId}/erasure`)
      .then((p) => !cancelled && setPreview(p))
      .catch((err: any) => !cancelled && setError(err.status === 403 ? 'Only administrators can erase customer data.' : err.message));
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const blocked = (preview?.blockers.length ?? 0) > 0;
  const ready = Boolean(preview) && !blocked && typed.trim().toUpperCase() === 'ERASE';

  const erase = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await withReauth(() => api.post(`/admin/customers/${contactId}/anonymize`, {}));
      onErased();
    } catch (err: any) {
      if (!isReauthCancelled(err)) setError(err.message || 'Could not erase this customer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      titleId="erase-customer-title"
      title={`Erase ${customerName}'s data?`}
      confirmLabel="Erase customer data"
      busyLabel="Erasing…"
      busy={busy}
      confirmDisabled={!ready}
      danger
      onClose={onClose}
      onConfirm={erase}
    >
      <div className="space-y-4 text-sm text-gray-700 dark:text-slate-300">
        <p>
          Name, email, phone, notes, tags, the business profile, free-text answers and photos are removed at once. Orders,
          payments, refunds and consent records stay, attached to an anonymous customer. This cannot be undone.
        </p>
        {!preview && !error && <p className="text-gray-500 dark:text-slate-400">Checking what this affects…</p>}
        {preview && (
          <>
            {preview.ticketsToVoid.length > 0 && (
              <div>
                <p className="font-semibold text-gray-900 dark:text-slate-100">
                  {preview.ticketsToVoid.length} upcoming ticket{preview.ticketsToVoid.length === 1 ? '' : 's'} will be voided with no refund
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.ticketsToVoid.map((t) => (
                    <li key={t.id}>
                      {t.eventName} · #{t.ticketNumber} · {formatEventDateTime(t.eventDate, t.eventTimezone)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.applicationsToWithdraw.length > 0 && (
              <p>
                Withdraws {preview.applicationsToWithdraw.length} open application{preview.applicationsToWithdraw.length === 1 ? '' : 's'}.
              </p>
            )}
            {preview.rsvpsToCancel.length > 0 && (
              <p>
                Cancels {preview.rsvpsToCancel.length} upcoming RSVP{preview.rsvpsToCancel.length === 1 ? '' : 's'}.
              </p>
            )}
            {blocked ? (
              <div role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-semibold">This customer can’t be erased yet</p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.blockers.map((b) => (
                    <li key={b.code + b.message}>{b.message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>
                <label htmlFor="erase-confirm" className="mb-1 block font-medium text-gray-900 dark:text-slate-100">
                  Type ERASE to confirm
                </label>
                <input
                  id="erase-confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
