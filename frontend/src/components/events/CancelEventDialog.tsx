'use client';

// Cancel event dialog (spec 054-C, replaces the spec 035 confirm). It loads
// what cancelling would touch (GET …/cancellation-preview), lets an admin
// choose to refund every order (needs orders.refund) or handle refunds
// themselves, add a note for buyers and preview the buyer email, and asks
// for the event name before it cancels through a step-up. Nothing here can
// be undone, and the dialog says so.

import { useEffect, useId, useState } from 'react';
import { useDialog } from '@/lib/useDialog';
import api from '@/services/api';
import { useCan } from '@/components/OrgContext';
import { isReauthCancelled, useReauth } from '@/app/admin/account/useReauth';

interface Preview {
  status: string;
  admissionMode: 'TICKETED' | 'RSVP';
  orders: number;
  tickets: number;
  collected: number;
  openCheckouts: number;
  vendorsPaid: number;
  /** Live applications (submitted, waitlisted, approved): all are closed and emailed. */
  applications: number;
  rsvps: number;
}

type Mode = 'REFUND_ALL' | 'MANUAL';

interface CancelEventDialogProps {
  orgId: string;
  eventId: string;
  eventName: string;
  /** After the event is cancelled (the caller reloads and shows a notice). */
  onCancelled: (mode: Mode | null) => void;
  onClose: () => void;
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export default function CancelEventDialog({ orgId, eventId, eventName, onCancelled, onClose }: CancelEventDialogProps) {
  const id = useId();
  const canRefund = useCan('orders.refund');
  const { withReauth } = useReauth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setMode] = useState<Mode | null>(null);
  // Refund everyone by default once permissions say this admin may; a choice made stays.
  const mode: Mode = chosen ?? (canRefund ? 'REFUND_ALL' : 'MANUAL');
  const [message, setMessage] = useState('');
  const [typed, setTyped] = useState('');
  const [email, setEmail] = useState<{ subject: string; html: string } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/organizations/${orgId}/events/${eventId}`;

  useEffect(() => {
    let live = true;
    api
      .get<Preview>(`${base}/cancellation-preview`)
      .then((p) => live && setPreview(p))
      .catch((err) => live && setLoadError(err?.message || 'Could not load what this event has sold'));
    return () => {
      live = false;
    };
  }, [base]);

  // Escape closes, Tab stays inside, focus returns to the menu that opened it; never mid-cancel.
  const panelRef = useDialog<HTMLDivElement>(true, () => {
    if (!busy) onClose();
  });

  const rsvp = preview?.admissionMode === 'RSVP';
  const paid = !!preview && (preview.orders > 0 || preview.vendorsPaid > 0);
  const nameMatches = typed.trim().toLowerCase() === eventName.trim().toLowerCase();
  const ready = !!preview && nameMatches && !busy;
  const body = paid ? { mode, ...(message.trim() && { message: message.trim() }) } : {};

  const showEmail = async () => {
    setEmailBusy(true);
    setError(null);
    try {
      setEmail(await api.post<{ subject: string; html: string }>(`${base}/cancellation-preview/email`, { mode, ...(message.trim() && { message: message.trim() }) }));
    } catch (err) {
      setError((err as Error)?.message || 'Could not preview the email');
    } finally {
      setEmailBusy(false);
    }
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await withReauth(() => api.post(`${base}/cancel`, body));
      onCancelled(paid ? mode : null);
    } catch (err) {
      if (!isReauthCancelled(err)) setError((err as Error)?.message || 'Failed to cancel the event');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div ref={panelRef} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl dark:bg-slate-800 sm:rounded-xl" data-testid="cancel-event-dialog">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-gray-900 dark:text-white">
          Cancel {eventName}?
        </h2>

        {loadError && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {loadError}
          </p>
        )}
        {!preview && !loadError && (
          <div aria-busy="true" aria-label="Loading what this event has sold" className="mt-4 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          </div>
        )}

        {preview && (
          <>
            <ul className="mt-3 space-y-1 text-sm text-gray-700 dark:text-slate-300" data-testid="cancel-event-summary">
              {rsvp ? (
                <>
                  <li>{plural(preview.rsvps, 'guest')} will be emailed that the event is cancelled.</li>
                  {preview.applications > 0 && <li>{plural(preview.applications, 'application')} will be closed and the applicants emailed.</li>}
                </>
              ) : (
                <>
                  <li>
                    {preview.orders > 0
                      ? `${plural(preview.orders, 'paid order')} · ${plural(preview.tickets, 'ticket')} · ${money(preview.collected)} collected`
                      : 'No paid ticket orders yet.'}
                  </li>
                  {preview.openCheckouts > 0 && <li>{plural(preview.openCheckouts, 'open checkout')} will be closed so nobody can pay.</li>}
                  {preview.applications > 0 && (
                    <li>
                      {plural(preview.applications, 'application')} will be closed and the applicants emailed
                      {preview.vendorsPaid > 0 ? `, including ${plural(preview.vendorsPaid, 'vendor')} who paid for a space` : ''}.
                    </li>
                  )}
                  <li>Sales stop at once and tickets no longer scan at the door.</li>
                </>
              )}
            </ul>

            {paid && (
              <fieldset className="mt-4">
                <legend className="text-sm font-medium text-gray-900 dark:text-white">Refunds</legend>
                <div className="mt-2 space-y-2">
                  <label className={`flex items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-accent-500 dark:border-slate-600 ${canRefund ? 'cursor-pointer border-gray-200' : 'border-gray-200 opacity-60'}`}>
                    <input type="radio" name={`${id}-mode`} value="REFUND_ALL" checked={mode === 'REFUND_ALL'} disabled={!canRefund} onChange={() => setMode('REFUND_ALL')} className="mt-0.5 h-4 w-4 accent-accent-600" />
                    <span>
                      <span className="block font-medium text-gray-900 dark:text-white">Refund every order now</span>
                      <span className="block text-gray-600 dark:text-slate-400">
                        {canRefund
                          ? 'Every buyer, and every vendor who paid for a space, gets the full amount back and an email once it’s done. Stripe keeps its processing fees.'
                          : "You don't have permission to refund orders. Ask an admin, or handle refunds yourself."}
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm has-[:checked]:border-accent-500 dark:border-slate-600">
                    <input type="radio" name={`${id}-mode`} value="MANUAL" checked={mode === 'MANUAL'} onChange={() => setMode('MANUAL')} className="mt-0.5 h-4 w-4 accent-accent-600" />
                    <span>
                      <span className="block font-medium text-gray-900 dark:text-white">I&apos;ll handle refunds myself</span>
                      <span className="block text-gray-600 dark:text-slate-400">Buyers are emailed that you&apos;ll contact them. Refund them from Orders.</span>
                    </span>
                  </label>
                </div>
              </fieldset>
            )}

            {paid && (
              <div className="mt-4">
                <label htmlFor={`${id}-message`} className="block text-sm font-medium text-gray-900 dark:text-white">
                  Note to buyers <span className="font-normal text-gray-500 dark:text-slate-400">(optional)</span>
                </label>
                <textarea id={`${id}-message`} rows={3} maxLength={2000} value={message} onChange={(e) => { setMessage(e.target.value); setEmail(null); }} className={field} placeholder="For example: The venue flooded. We hope to see you at our spring show." />
                <button type="button" onClick={() => void showEmail()} disabled={emailBusy} className="mt-2 text-sm font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800 disabled:opacity-50 dark:text-accent-300">
                  {emailBusy ? 'Loading preview…' : email ? 'Refresh email preview' : 'Preview the buyer email'}
                </button>
                {email && (
                  <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-slate-600">
                    <p className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      <span className="font-medium">Subject:</span> {email.subject}
                    </p>
                    <iframe title="Buyer email preview" sandbox="" srcDoc={email.html} className="h-72 w-full bg-white" />
                  </div>
                )}
              </div>
            )}

            <div className="mt-4">
              <label htmlFor={`${id}-confirm`} className="block text-sm font-medium text-gray-900 dark:text-white">
                Type <span className="font-semibold">{eventName}</span> to confirm
              </label>
              <input id={`${id}-confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={field} aria-describedby={`${id}-undo`} />
              <p id={`${id}-undo`} className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                {paid && mode === 'REFUND_ALL' ? "Cancelling and refunds can't be undone." : "Cancelling can't be undone."}
              </p>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Keep event
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready}
            className="min-h-11 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : paid && mode === 'REFUND_ALL' ? 'Cancel and refund everyone' : 'Cancel event'}
          </button>
        </div>
      </div>
    </div>
  );
}
