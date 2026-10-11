'use client';

// What stopped a publish (spec 050-C): the readiness blockers as a text list,
// each linking to where it is fixed. Announced as an alert; the icon is
// decorative, the words carry the state.

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { readinessHref, type ReadinessItem } from '@/lib/eventReadiness';

interface Props {
  blockers: ReadinessItem[];
  eventId: string;
  orgId: string | null;
  className?: string;
}

export default function PublishBlockers({ blockers, eventId, orgId, className = '' }: Props) {
  if (!blockers.length) return null;
  const headingId = `publish-blockers-${eventId}`;
  return (
    <div
      role="alert"
      aria-labelledby={headingId}
      className={`rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
    >
      <p id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {blockers.length === 1 ? 'Fix 1 thing before publishing' : `Fix ${blockers.length} things before publishing`}
      </p>
      <ul className="mt-2 divide-y divide-amber-200 dark:divide-amber-800/60">
        {blockers.map((b) => (
          <li key={`${b.code}-${b.formId ?? ''}`}>
            <Link
              href={readinessHref(b, eventId, orgId)}
              className="relative z-10 flex min-h-11 items-center justify-between gap-3 rounded py-2 text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              <span>{b.message}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold">
                Fix
                <ChevronRight className="h-4 w-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
