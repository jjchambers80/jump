'use client';

// Spec 044D: a page's Apply button opens its standing form in a native
// <dialog> — a full-screen sheet on phones, a right-hand panel from `sm`.
// The buttons are plain links to the standalone form page (they work without
// JavaScript and can be shared); this island upgrades any `[data-apply-cta]`
// link on the page to open the panel, and opens it on load for `#apply`.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Lock, X } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';
import { ApplySteps, useApplyForm, type SubmitResult } from './ApplySteps';

export default function ApplyDrawer({ organizationId, formSlug }: { organizationId: string; formSlug: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const apply = useApplyForm(form, {
    submitUrl: `/organizations/${encodeURIComponent(organizationId)}/public/apply/${encodeURIComponent(formSlug)}`,
    draftKey: `jump.apply.${organizationId}.${formSlug}`,
  });

  const show = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    setDone(null);
    if (!form) {
      setLoadError(null);
      api
        .get<PublicForm>(`/organizations/${encodeURIComponent(organizationId)}/public/apply/${encodeURIComponent(formSlug)}`)
        .then(setForm)
        .catch((err) => setLoadError(err?.message || 'This form is not available right now.'));
    }
  }, [form, organizationId, formSlug]);

  // Any Apply link on the page opens the panel; #apply opens it on arrival.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('[data-apply-cta]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      (link as HTMLElement).focus();
      show();
    };
    const onHash = () => {
      if (window.location.hash === '#apply') show();
    };
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHash);
    };
  }, [show]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  // Typed answers survive closing (sessionStorage); chosen photos do not.
  const close = () => {
    const hasFiles = apply.photos.length > 0 || Object.keys(apply.answerPhotos).length > 0;
    if (!done && hasFiles && !window.confirm('Close the application? Your answers stay saved on this device, but you will need to add your photos again.')) {
      return;
    }
    setOpen(false);
    if (window.location.hash === '#apply') history.replaceState(null, '', window.location.pathname + window.location.search);
    triggerRef.current?.focus();
  };

  const closedLine = form ? acceptanceLine(form.acceptance) : null;
  const statusPath = done ? new URL(done.statusUrl, window.location.origin) : null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="apply-drawer-title"
      data-testid="apply-drawer"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      className="m-0 h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px] sm:ml-auto sm:w-[min(560px,100vw)]"
    >
      <form
        onSubmit={async (event) => {
          const result = await apply.submit(event);
          if (result) setDone(result);
        }}
        className="flex h-full flex-col bg-gray-50 motion-safe:animate-slide-up dark:bg-slate-900 sm:rounded-l-2xl sm:motion-safe:animate-slide-in-right"
      >
        <header className="flex items-start gap-3 border-b border-gray-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="min-w-0 flex-1">
            {form?.organizationName && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-slate-400">{form.organizationName}</p>
            )}
            <h2 id="apply-drawer-title" className="text-lg font-bold leading-snug text-gray-900 dark:text-white">
              {form?.name ?? 'Application'}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link dark:text-slate-300 dark:hover:bg-slate-700"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
          {done ? (
            <div className="flex flex-col items-center px-2 pt-10 text-center" data-testid="apply-drawer-success">
              <CheckCircle2 className="h-12 w-12 text-brand-link motion-safe:animate-stamp-in" aria-hidden />
              <h3 ref={successRef} tabIndex={-1} className="mt-4 text-2xl font-bold text-gray-900 focus:outline-none dark:text-white">
                Application sent
              </h3>
              <p role="status" className="mt-2 max-w-sm text-gray-600 dark:text-slate-300">
                {form?.successMessage || `Thanks for applying. ${form?.organizationName || 'The organizer'} will review it and email you their decision.`}
              </p>
            </div>
          ) : loadError ? (
            <p role="alert" className="text-red-700 dark:text-red-300">{loadError}</p>
          ) : !form ? (
            <p className="text-gray-600 dark:text-slate-400">Loading…</p>
          ) : closedLine ? (
            <div className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800" data-testid="apply-closed">
              <Lock className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
              <p className="font-semibold text-gray-900 dark:text-slate-100">This form is {closedLine.toLowerCase()}.</p>
            </div>
          ) : (
            <ApplySteps form={form} apply={apply} idPrefix="drawer-" />
          )}
        </div>

        <footer className="border-t border-gray-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 dark:border-slate-700 dark:bg-slate-800 sm:px-5">
          {done ? (
            <div className="flex gap-3">
              {statusPath && (
                <Link
                  href={statusPath.pathname + statusPath.search}
                  className="flex h-12 flex-1 items-center justify-center rounded-xl border border-gray-300 font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link dark:border-slate-600 dark:text-white dark:hover:bg-slate-700"
                >
                  View your application
                </Link>
              )}
              <button type="button" onClick={close} className="h-12 flex-1 rounded-xl bg-brand font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2">
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {apply.error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                  {apply.error}
                </p>
              )}
              <button
                type="submit"
                disabled={!form || Boolean(closedLine) || apply.submitting}
                className="h-12 w-full rounded-xl bg-brand font-semibold text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-link focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-slate-800"
              >
                {apply.submitting ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
          )}
        </footer>
      </form>
    </dialog>
  );
}
