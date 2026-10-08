'use client';

// Section editor flyout (spec 037 D10): small edits happen in a panel that
// slides in from the right on desktop and rises as a bottom sheet on phones,
// over the read-only page they belong to. One form, Cancel / Save in a
// footer that never scrolls away, Escape and the backdrop close (asking first
// when there are unsaved changes), focus is trapped and returned.

import React, { FormEvent, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Flyout({
  title,
  description,
  dirty,
  saving,
  saveDisabled,
  submitLabel = 'Save',
  error,
  returnFocusRef,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  dirty: boolean;
  saving: boolean;
  saveDisabled?: boolean;
  submitLabel?: string;
  error?: string | null;
  /** Element that opened the flyout; focus goes back to it on close. */
  returnFocusRef?: React.RefObject<HTMLElement>;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLFormElement>(null);

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm('Discard your changes?')) return;
    onClose();
  };
  // Keep the latest closure for the document listener.
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  useEffect(() => {
    const opener = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end sm:items-stretch">
      <div
        aria-hidden
        onClick={requestClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
      />
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl motion-safe:animate-slide-up dark:bg-slate-900 sm:h-full sm:max-h-none sm:w-[28rem] sm:rounded-none sm:rounded-l-2xl sm:motion-safe:animate-slide-in-right"
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="-mr-1 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
              {error}
            </p>
          )}
          {children}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/60">
          <span className={`text-xs ${dirty ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400'}`} role="status">
            {dirty ? 'Unsaved changes' : 'No changes yet'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || saveDisabled || !dirty}
              className="rounded-md bg-accent-500 px-3.5 py-1.5 text-sm font-semibold text-gray-950 shadow-sm hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              {saving ? 'Saving…' : submitLabel}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
