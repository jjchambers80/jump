'use client';

// A registration event's page body (spec 057): only its form's one Register
// button, sticky at the bottom of the screen. No About section: the form's
// intro says what the event is about. Registering goes through the apply
// pages; an approved registrant of a paid form chooses and pays from the
// status page, as before. Brand tokens only (gotcha 6).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';
import Placeholder from './Placeholder';
import type { EventPageEvent } from './eventPage';

export default function EventRegister({ event, preview = false }: { event: EventPageEvent; preview?: boolean }) {
  const [fetched, setFetched] = useState<PublicForm[] | null>(null);
  const forms = event.previewForms ?? fetched;

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

  // One form per registration event (409 FORM_EXISTS), so one button.
  const form = forms?.[0];
  const closed = form && !preview ? acceptanceLine(form.acceptance) : null;
  const BUTTON = 'flex min-h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-lg font-bold shadow-lg';

  return (
    <div>
      {/* Sticky in the page body: the card drops overflow-hidden for it (EventPageView) */}
      <section id="register" aria-label="Register" className="sticky bottom-4 z-30 scroll-mt-6">
        {forms === null ? (
          <div aria-busy="true" aria-label="Loading the registration form" className="h-14 animate-pulse rounded-full bg-gray-100 motion-reduce:animate-none dark:bg-slate-700/60" />
        ) : !form ? (
          <p className="text-base text-gray-600 dark:text-slate-300">
            {preview ? <Placeholder>Set up the registration form</Placeholder> : 'Registration is not open yet.'}
          </p>
        ) : closed ? (
          <span className={`${BUTTON} bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300`}>{closed}</span>
        ) : preview ? (
          <span className={`${BUTTON} bg-brand text-brand-fg`}>
            Register
            <ArrowRight className="h-5 w-5" aria-hidden />
          </span>
        ) : (
          <Link
            href={`/events/${event.id}/apply/${form.slug}`}
            className={`group ${BUTTON} bg-brand text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800`}
          >
            Register
            <span className="sr-only">: {form.name}</span>
            <ArrowRight className="h-5 w-5 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </section>
    </div>
  );
}
