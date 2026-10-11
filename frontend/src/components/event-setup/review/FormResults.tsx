'use client';

// Done's per-form publish results (spec 050 §7.2 `formResults`) as text: which
// forms opened and why any stayed closed, mounted in 050-I's DoneStep.

import { CheckCircle2, MinusCircle } from 'lucide-react';
import { useState } from 'react';
import { readPublishOutcome } from './publishOutcome';

/** Refusal messages often start with the form's name already; never say it twice. */
export function resultText(r: { name: string; status: string; message?: string }) {
  if (r.status === 'OPEN') return `${r.name}: open for applications.`;
  if (!r.message) return `${r.name}: still closed.`;
  return r.message.startsWith(r.name) ? `Still closed. ${r.message}` : `${r.name}: still closed. ${r.message}`;
}

export default function FormResults({ eventId }: { eventId: string }) {
  const [outcome] = useState(() => readPublishOutcome(eventId));
  if (!outcome?.results.length) return null;
  return (
    <section aria-labelledby="done-forms" className="mt-6">
      <h2 id="done-forms" className="text-base font-semibold text-gray-900 dark:text-white">
        Applications
      </h2>
      <ul className="mt-2 space-y-2 text-sm text-gray-800 dark:text-slate-200" data-testid="form-results">
        {outcome.results.map((r) => (
          <li key={r.formId} className="flex items-start gap-2">
            {r.status === 'OPEN' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <MinusCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span>
              {resultText(r)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
