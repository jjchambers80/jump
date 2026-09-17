'use client';

// "Get involved" strip on the public event page (spec 011): lists open
// application forms (vendors, sponsors, press, panels). Renders nothing when
// the event has no visible forms, so ticket-only events are unchanged.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';

export default function GetInvolved({ eventId }: { eventId: string }) {
  const [forms, setForms] = useState<PublicForm[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: PublicForm[] }>(`/events/${eventId}/applications/forms`)
      .then((r) => {
        if (!cancelled) setForms(r.data || []);
      })
      .catch(() => {
        if (!cancelled) setForms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (forms.length === 0) return null;

  return (
    <section className="px-6 sm:px-8 pb-6" aria-labelledby="get-involved-heading" data-testid="get-involved">
      <h2 id="get-involved-heading" className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-3">Get involved</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {forms.map((form) => {
          const closed = acceptanceLine(form.acceptance);
          const body = (
            <>
              <span className="font-semibold text-gray-900 dark:text-slate-100">{form.name}</span>
              <span className="text-xs text-gray-600 dark:text-slate-400">{closed ?? (form.kind === 'PAID' ? 'Apply for a space' : 'Free to apply')}</span>
            </>
          );
          return (
            <li key={form.id}>
              {closed ? (
                <div className="flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 px-4 py-3 opacity-70">{body}</div>
              ) : (
                <Link href={`/events/${eventId}/apply/${form.slug}`} className="flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 px-4 py-3 hover:border-brand-link transition-colors">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
