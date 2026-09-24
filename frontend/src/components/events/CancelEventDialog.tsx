'use client';

// Cancel event confirm dialog — replaces window.confirm (spec 035 D3).
// Calls onConfirm; onClose is how the caller dismisses.

import { useRef, useEffect } from 'react';

interface CancelEventDialogProps {
  eventName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function CancelEventDialog({ eventName, busy, onConfirm, onClose }: CancelEventDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handler);
    cancelRef.current?.focus();
    return () => document.removeEventListener('keydown', handler);
  }, [busy, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-event-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-800">
        <h2 id="cancel-event-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          Cancel event
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
          Are you sure you want to cancel <strong>{eventName}</strong>?{' '}
          This will email all ticket holders and release their reservations.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Keep event
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : 'Cancel event'}
          </button>
        </div>
      </div>
    </div>
  );
}