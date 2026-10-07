'use client';

// Error summary when Save finds photos without alt text: takes focus, and
// each line opens that photo's panel.

import { forwardRef } from 'react';
import type { MissingAlt } from '@/lib/galleries';

const AltTextSummary = forwardRef<HTMLDivElement, { problems: MissingAlt[]; onOpen: (itemKey: string) => void }>(
  function AltTextSummary({ problems, onOpen }, ref) {
    if (!problems.length) return null;
    return (
      <div
        ref={ref}
        tabIndex={-1}
        role="alert"
        data-testid="alt-summary"
        className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
      >
        <p className="font-semibold">
          {problems.length} {problems.length === 1 ? 'photo needs' : 'photos need'} alt text before you can save
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {problems.map((problem) => (
            <li key={problem.itemKey}>
              <button type="button" onClick={() => onOpen(problem.itemKey)} className="text-left underline">
                {problem.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
);

export default AltTextSummary;
