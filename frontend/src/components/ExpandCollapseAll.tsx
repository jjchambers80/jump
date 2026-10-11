'use client';

// "Expand all" / "Collapse all" text toggle for the cart line-item accordions.
// Sits flush right on the same row as the cart heading.

import React from 'react';

interface ExpandCollapseAllProps {
  allOpen: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Off without a handler (spec 050 preview): id of the note saying why; stays focusable. */
  offReasonId?: string;
}

export default function ExpandCollapseAll({ allOpen, onToggle, disabled, offReasonId }: ExpandCollapseAllProps) {
  return (
    <button
      type="button"
      onClick={offReasonId ? undefined : onToggle}
      disabled={disabled}
      aria-disabled={offReasonId ? true : undefined}
      aria-describedby={offReasonId}
      aria-pressed={allOpen}
      data-testid="expand-collapse-all"
      className="ml-auto shrink-0 text-xs font-semibold text-brand-link hover:underline disabled:text-gray-400 dark:disabled:text-slate-500 disabled:no-underline disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-disabled:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
    >
      {allOpen ? 'Collapse all' : 'Expand all'}
    </button>
  );
}
