'use client';

// Plain confirm dialog (no form state, no discard prompt): Escape / backdrop
// cancel, focus lands on Confirm and returns to the opener on close.

import { ReactNode, RefObject, useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  titleId: string;
  title: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  danger?: boolean;
  returnFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}

export default function ConfirmDialog({
  titleId,
  title,
  confirmLabel,
  busyLabel = 'Working…',
  busy = false,
  danger = false,
  returnFocusRef,
  onClose,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const returnTo = returnFocusRef?.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
    // Mount-only focus management.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      >
        <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        {children && (
          <div className="mt-3 space-y-3 text-sm text-gray-700 dark:text-slate-300">{children}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              danger
                ? 'bg-red-600 hover:bg-red-500 focus:ring-red-500'
                : 'bg-indigo-600 hover:bg-indigo-500 focus:ring-indigo-500'
            }`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
