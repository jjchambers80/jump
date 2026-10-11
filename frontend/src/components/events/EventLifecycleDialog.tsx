'use client';

// Confirm dialog for the spec 050-D lifecycle actions: close sales, reopen
// sales, unpublish, delete draft. Calls the endpoint itself so a refusal
// (409 UNPUBLISH_BLOCKED / DELETE_BLOCKED) shows its reasons in text here.
// Focus is trapped while open and returns to the menu trigger on close.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, EyeOff, Lock, LockOpen, Trash2, type LucideIcon } from 'lucide-react';
import api from '@/services/api';

export type LifecycleAction = 'close-sales' | 'reopen-sales' | 'unpublish' | 'delete';

const COPY: Record<LifecycleAction, { title: string; body: string; confirm: string; busy: string; icon: LucideIcon; destructive: boolean }> = {
  'close-sales': {
    title: 'Close sales',
    body: 'The event stays published. New ticket checkouts, RSVPs and applications stop. Tickets already sold stay valid, and approved vendors can still pick and pay for their space. You can reopen sales at any time.',
    confirm: 'Close sales',
    busy: 'Closing…',
    icon: Lock,
    destructive: true,
  },
  'reopen-sales': {
    title: 'Reopen sales',
    body: 'Checkout, RSVPs and new applications open again on the event page.',
    confirm: 'Reopen sales',
    busy: 'Reopening…',
    icon: LockOpen,
    destructive: false,
  },
  unpublish: {
    title: 'Unpublish event',
    body: 'The event goes back to a draft and its public page stops working. This is only possible while nobody has bought a ticket, RSVP’d or applied.',
    confirm: 'Unpublish',
    busy: 'Unpublishing…',
    icon: EyeOff,
    destructive: true,
  },
  delete: {
    title: 'Delete draft',
    body: 'The draft, its tiers, forms, add-ons and floor map are deleted for good. This cannot be undone.',
    confirm: 'Delete draft',
    busy: 'Deleting…',
    icon: Trash2,
    destructive: true,
  },
};

interface Props {
  action: LifecycleAction;
  orgId: string;
  eventId: string;
  eventName: string;
  onClose: () => void;
  onDone: (action: LifecycleAction) => void;
}

export default function EventLifecycleDialog({ action, orgId, eventId, eventName, onClose, onDone }: Props) {
  const copy = COPY[action];
  const Icon = copy.icon;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reasons: string[] } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  // On open, and after a refusal removes the confirm button, focus the safe choice.
  useEffect(() => {
    keepRef.current?.focus();
  }, [error]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const path = `/organizations/${orgId}/events/${eventId}`;
    try {
      if (action === 'delete') await api.delete(path);
      else await api.post(`${path}/${action}`, {});
      onDone(action);
    } catch (err: any) {
      const reasons: string[] = err?.details?.reasons ?? [];
      setError({ message: err?.message || 'Something went wrong. Try again.', reasons });
      setBusy(false);
    }
  };

  const titleId = `lifecycle-${action}-title`;
  const bodyId = `lifecycle-${action}-body`;
  const blocked = Boolean(error?.reasons.length);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div ref={panelRef} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-800">
        <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <Icon className={`h-5 w-5 ${copy.destructive ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'}`} aria-hidden />
          {copy.title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-gray-700 dark:text-slate-300">
          <strong className="font-semibold [overflow-wrap:anywhere]">{eventName}</strong>: {copy.body}
        </p>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            <p className="flex items-start gap-2 font-medium">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {blocked ? `This event can’t be ${action === 'delete' ? 'deleted' : 'unpublished'} because it has:` : error.message}
            </p>
            {blocked && (
              <>
                <ul className="mt-1 list-disc pl-10">
                  {error.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="mt-2">{action === 'delete' ? 'Keep it as a draft instead.' : 'Close sales or cancel the event instead.'}</p>
              </>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={keepRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {blocked ? 'Close' : 'Go back'}
          </button>
          {!blocked && (
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
                copy.destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-700 hover:bg-emerald-600'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {busy ? copy.busy : copy.confirm}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
