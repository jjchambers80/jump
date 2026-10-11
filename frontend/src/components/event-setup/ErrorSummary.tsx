'use client';

// Error summary after a failed Next (spec 050 §11.4): role="alert", takes
// focus, one link per field. A link focuses its field; no #anchor jump, which
// would scroll the full-screen admin frame.

import { forwardRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FieldError } from './steps';

const ErrorSummary = forwardRef<HTMLDivElement, { errors: FieldError[]; onOpenStep: (error: FieldError) => void }>(function ErrorSummary({ errors, onOpenStep }, ref) {
  if (errors.length === 0) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      aria-labelledby="setup-error-summary-title"
      className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-800 dark:bg-red-950/40"
    >
      <h2 id="setup-error-summary-title" className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {errors.length === 1 ? 'Fix 1 thing to continue' : `Fix ${errors.length} things to continue`}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
        {errors.map((error) => (
          <li key={`${error.field}-${error.message}`}>
            <a
              href={`#${error.field}`}
              onClick={(event) => {
                event.preventDefault();
                const field = document.getElementById(error.field);
                if (field) field.focus();
                else onOpenStep(error);
              }}
              className="font-medium text-red-800 underline underline-offset-2 hover:no-underline dark:text-red-200"
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});

export default ErrorSummary;
