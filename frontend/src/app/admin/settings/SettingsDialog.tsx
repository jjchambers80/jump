'use client';

import { FormEvent, ReactNode, RefObject, useEffect, useRef } from 'react';

interface SettingsDialogProps {
  /** Unique id for the heading; also used by tests to target the dialog. */
  titleId: string;
  title: string;
  /** Unsaved changes present — closing asks for confirmation. */
  dirty: boolean;
  saving: boolean;
  /** Disable Save beyond the dirty/saving checks (e.g. a required field is empty). */
  saveDisabled?: boolean;
  /** A nested dialog is open; this shell stops handling keys and hides from AT. */
  childActive?: boolean;
  /** Focused when the dialog opens. Falls back to the first field. */
  initialFocusRef?: RefObject<HTMLElement>;
  /** Focused again when the dialog closes. */
  returnFocusRef: RefObject<HTMLElement>;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}

/**
 * Modal shell shared by the Settings › General dialogs: backdrop, focus trap,
 * Escape/backdrop close with a discard prompt when dirty, and a header with
 * Cancel/Save. Callers own the form state and render the fields as children.
 */
export default function SettingsDialog({
  titleId,
  title,
  dirty,
  saving,
  saveDisabled = false,
  childActive = false,
  initialFocusRef,
  returnFocusRef,
  onClose,
  onSubmit,
  children,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(saving);
  const childActiveRef = useRef(childActive);
  dirtyRef.current = dirty;
  savingRef.current = saving;
  childActiveRef.current = childActive;

  const requestClose = () => {
    if (savingRef.current) return;
    if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  };

  useEffect(() => {
    const target =
      initialFocusRef?.current ||
      dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    target?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (childActiveRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (savingRef.current) return;
        if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return;
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus();
    };
    // Focus management runs once per mount; refs read current values.
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={childActive || undefined}
        aria-labelledby={titleId}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-slate-700">
            <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
              {title}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                disabled={saving}
                className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !dirty || saveDisabled}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </header>

          <div className="min-h-0 overflow-y-auto px-5 py-5">{children}</div>
        </form>
      </div>
    </div>
  );
}
