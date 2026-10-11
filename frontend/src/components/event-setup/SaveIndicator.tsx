'use client';

// Save state in words (spec 050 §11.5), in one role="status" element: never
// only an icon. "Couldn't save" carries its own Retry button.

import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { SaveStatus } from './stepSaver';

export default function SaveIndicator({
  status,
  invalidCount,
  savedAt,
  hasRow,
  onRetry,
}: {
  status: SaveStatus;
  invalidCount: number;
  savedAt: Date | null;
  /** Before step 3 nothing is on the server yet. */
  hasRow: boolean;
  onRetry: () => void;
}) {
  let body: React.ReactNode;
  if (!hasRow) body = <span>Not saved yet</span>;
  else if (status === 'saving')
    body = (
      <>
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
        <span>Saving…</span>
      </>
    );
  else if (status === 'error')
    body = (
      <>
        <AlertTriangle className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden />
        <span className="text-red-800 dark:text-red-300">Couldn&apos;t save —</span>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded px-1 font-semibold text-red-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-red-300 sm:min-h-0"
        >
          Retry
        </button>
      </>
    );
  else if (status === 'invalid') body = <span>Not saved: fix {invalidCount === 1 ? '1 field' : `${invalidCount} fields`}</span>;
  else if (status === 'dirty') body = <span>Unsaved changes</span>;
  else
    body = (
      <>
        <Check className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden />
        <span title={savedAt ? `Saved at ${savedAt.toLocaleTimeString()}` : undefined}>Saved</span>
      </>
    );

  return (
    <div role="status" className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-slate-300">
      {body}
    </div>
  );
}
