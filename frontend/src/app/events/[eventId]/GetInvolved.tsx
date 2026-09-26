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

// Organizers name forms in full ("2026 Game and Geek Vendor Application");
// the pill only needs the role. The full name stays in the accessible name.
const ROLES: [RegExp, string][] = [
  [/vendor|exhibit|booth|merchant|artist/i, 'Become a vendor'],
  [/sponsor/i, 'Become a sponsor'],
  [/press|media/i, 'Press pass'],
  [/panel|speaker|talk/i, 'Host a panel'],
  [/volunteer/i, 'Volunteer'],
];

function shortLabel(name: string): string {
  return ROLES.find(([pattern]) => pattern.test(name))?.[1] ?? 'Apply';
}

export default function GetInvolved({ eventId, className = '' }: { eventId: string; className?: string }) {
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

  // Two forms for the same role ("Apply", "Apply") would be ambiguous: fall back to the names.
  const labels = forms.map((form) => shortLabel(form.name));
  const ambiguous = new Set(labels).size < labels.length;

  return (
    <ul className={`flex flex-wrap gap-2 ${className}`} aria-label="Get involved" data-testid="get-involved">
      {forms.map((form, i) => {
        const closed = acceptanceLine(form.acceptance);
        const label = ambiguous ? form.name : labels[i];
        return (
          <li key={form.id}>
            {closed ? (
              <span
                title={form.name}
                className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-white/70 ring-1 ring-inset ring-white/15"
              >
                {label}
                <span className="text-xs text-white/60">· {closed}</span>
              </span>
            ) : (
              <Link
                href={`/events/${eventId}/apply/${form.slug}`}
                aria-label={`${label}: ${form.name}`}
                title={form.name}
                className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-gray-900 shadow-sm shadow-black/20 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/60"
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
