'use client';

// Photos without alt text: a warning, never a blocker. Saving works; on the
// storefront an undescribed photo is named by its position ("Photo 3 of 35")
// until someone describes it. Each line opens that photo's panel.

import { AlertTriangle } from 'lucide-react';
import type { MissingAlt } from '@/lib/galleries';

export default function AltTextSummary({ problems, onOpen }: { problems: MissingAlt[]; onOpen: (itemKey: string) => void }) {
  if (!problems.length) return null;
  const count = problems.length;
  return (
    <section
      aria-labelledby="alt-summary-title"
      data-testid="alt-summary"
      className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
    >
      <h2 id="alt-summary-title" className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
        {count} {count === 1 ? 'photo has' : 'photos have'} no alt text
      </h2>
      <p className="mt-1">
        You can still save. Until a photo is described, screen reader users hear only its position, such as “Photo 3 of
        20”. Describe what each photo shows, or mark purely decorative ones as decorative.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer font-medium underline">Show the photos</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {problems.map((problem) => (
            <li key={problem.itemKey}>
              <button type="button" onClick={() => onOpen(problem.itemKey)} className="text-left underline">
                {problem.label}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
