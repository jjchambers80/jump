'use client';

// A registration event's page body (spec 057): what it is about, then its
// form with one Register button. Registering goes through the existing apply
// pages; an approved registrant of a paid form chooses and pays from the
// status page, as before. Brand tokens only (gotcha 6).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';
import EventAbout from './EventAbout';
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

  return (
    <div className="space-y-8">
      <EventAbout description={event.description} />
      <section id="register" aria-labelledby="register-heading" className="scroll-mt-6">
        <h2 id="register-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">
          Register
        </h2>
        {forms === null ? (
          <div aria-busy="true" aria-label="Loading the registration form" className="h-28 animate-pulse rounded-2xl bg-gray-100 motion-reduce:animate-none dark:bg-slate-700/60" />
        ) : forms.length === 0 ? (
          <p className="text-base text-gray-600 dark:text-slate-300">
            {preview ? <Placeholder>Set up the registration form</Placeholder> : 'Registration is not open yet.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {forms.map((form) => {
              const closed = preview ? null : acceptanceLine(form.acceptance);
              return (
                <li key={form.id} className="rounded-2xl p-5 ring-1 ring-inset ring-gray-200 dark:ring-slate-700">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-lg font-bold leading-snug tracking-tight text-gray-900 dark:text-slate-100">{form.name}</p>
                      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                        {form.kind === 'PAID'
                          ? 'Registering is free. Once approved, you choose and pay.'
                          : 'Free to register. The organizer reviews each one.'}
                      </p>
                    </div>
                    {closed ? (
                      <span className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-gray-100 px-5 text-sm font-semibold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                        {closed}
                      </span>
                    ) : preview ? (
                      <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-brand-fg">
                        Register
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </span>
                    ) : (
                      <Link
                        href={`/events/${event.id}/apply/${form.slug}`}
                        className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand px-5 text-sm font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
                      >
                        Register
                        <span className="sr-only">: {form.name}</span>
                        <ArrowRight className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
