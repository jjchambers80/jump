'use client';

// "Get involved" links in the event hero (spec 011): one short pill per
// visible application form (vendors, sponsors, press, panels), so applicants
// find the form without scrolling past every ticket tier. Renders nothing when
// the event has no visible forms, so ticket-only events are unchanged.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import api from '@/services/api';
import { acceptanceLine, type PublicForm } from '@/lib/applications';

export default function GetInvolved({
  eventId,
  className = '',
  preview = false,
  forms: given,
}: {
  eventId: string;
  className?: string;
  /** Staff draft preview (spec 050 F): pills show, but nothing opens the form. */
  preview?: boolean;
  /** Wizard preview: the forms it already has (DRAFT included), so nothing is fetched. */
  forms?: PublicForm[];
}) {
  const [fetched, setForms] = useState<PublicForm[]>([]);
  const forms = given ?? fetched;

  useEffect(() => {
    if (given) return;
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
  }, [eventId, given]);

  if (forms.length === 0) return null;

  return (
    <ul id="get-involved" className={`flex flex-wrap gap-2 ${className}`} aria-label="Get involved" data-testid="get-involved">
      {forms.map((form) => {
        const closed = preview ? 'Preview' : acceptanceLine(form.acceptance);
        // Event forms have no button label (it is a standing-form setting): the pill is the form name.
        const label = form.name;
        return (
          <li key={form.id}>
            {closed ? (
              <span
                className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-hero-ink/70 ring-1 ring-inset ring-hero-ink/15"
              >
                {label}
                <span className="text-xs text-hero-ink/60">· {closed}</span>
              </span>
            ) : (
              <Link
                // Spec 057: a linked registration event's form is that event's page.
                href={form.eventId && form.eventId !== eventId ? `/events/${form.eventId}` : `/events/${eventId}/apply/${form.slug}`}
                className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-hero-ink px-4 text-sm font-semibold text-hero-paper shadow-sm shadow-black/20 transition-colors hover:bg-hero-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hero-ink focus-visible:ring-offset-2 focus-visible:ring-offset-hero-paper"
              >
                {label}
                <ArrowUpRight
                  className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
