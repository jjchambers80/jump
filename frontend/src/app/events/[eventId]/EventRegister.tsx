'use client';

// A registration event's page body (spec 057): its one form, inline, and a
// Register button sticky at the bottom of the screen. The form's intro says
// what the event is about. On success the registrant lands on their status
// page, where an approved registrant of a paid form chooses and pays, as
// before. Brand tokens only (gotcha 6).

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';
import { ApplySteps, useApplyForm } from '@/components/applications/ApplySteps';
import { draftPreviewForm } from '@/components/event-setup/previewMessages';
import type { EventPageEvent } from './eventPage';

const BUTTON = 'flex min-h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-lg font-bold shadow-lg';

export default function EventRegister({ event, preview = false }: { event: EventPageEvent; preview?: boolean }) {
  const router = useRouter();
  const [fetched, setFetched] = useState<PublicForm[] | null>(null);
  const forms = event.previewForms ?? fetched;
  // One form per registration event (409 FORM_EXISTS). The setup preview shows
  // the blank form a new one starts as (email + consent) until it exists.
  const stub = useMemo(() => (preview ? draftPreviewForm({ name: event.name || 'Registration', kind: 'FREE' }, event.organizationName) : null), [preview, event.name, event.organizationName]);
  const form = forms?.[0] ?? (forms ? stub : null);
  const apply = useApplyForm(form, { submitUrl: `/events/${event.id}/applications` });

  useEffect(() => {
    if (event.previewForms) return;
    let live = true;
    api
      .get<{ data: PublicForm[] }>(`/events/${event.id}/applications/forms`)
      .then((r) => live && setFetched((r.data || []).filter((f) => (f.eventId ?? event.id) === event.id)))
      .catch(() => live && setFetched([]));
    return () => {
      live = false;
    };
  }, [event.id, event.previewForms]);

  const closed = form && !preview ? acceptanceLine(form.acceptance) : null;

  const handleSubmit = async (e: FormEvent) => {
    if (preview) return e.preventDefault();
    const result = await apply.submit(e);
    if (result) {
      const url = new URL(result.statusUrl);
      router.push(url.pathname + url.search);
    }
  };

  if (forms === null) {
    return <div aria-busy="true" aria-label="Loading the registration form" className="h-64 animate-pulse rounded-2xl bg-gray-100 motion-reduce:animate-none dark:bg-slate-700/60" />;
  }
  if (!form) {
    return (
      <p className="text-base text-gray-600 dark:text-slate-300">
        Registration is not open yet.
      </p>
    );
  }
  if (closed) {
    return (
      <p id="register" className={`${BUTTON} bg-gray-100 text-gray-600 shadow-none dark:bg-slate-700 dark:text-slate-300`}>
        {closed}
      </p>
    );
  }

  return (
    <form id="register" onSubmit={handleSubmit} noValidate aria-label={form.name} data-testid="apply-form" className="scroll-mt-6 space-y-6">
      <ApplySteps form={form} apply={apply} />
      {apply.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {apply.error}
        </p>
      )}
      {/* Sticky in the page body: the card drops overflow-hidden for it (EventPageView) */}
      <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-30">
        <button
          type="submit"
          disabled={apply.submitting || preview}
          className={`group ${BUTTON} bg-brand text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-default dark:focus-visible:ring-offset-slate-800 ${apply.submitting ? 'opacity-60' : ''}`}
        >
          {apply.submitting ? 'Registering…' : 'Register'}
          {!apply.submitting && <ArrowRight className="h-5 w-5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />}
        </button>
      </div>
    </form>
  );
}
