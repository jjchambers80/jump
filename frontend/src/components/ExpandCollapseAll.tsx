'use client';

// "Expand all" / "Collapse all" text toggle for the cart line-item accordions.
// Sits flush right on the same row as the cart heading.

import React from 'react';

interface ExpandCollapseAllProps {
  allOpen: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export default function ExpandCollapseAll({ allOpen, onToggle, disabled }: ExpandCollapseAllProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={allOpen}
      data-testid="expand-collapse-all"
      className="ml-auto shrink-0 text-xs font-semibold text-brand-link hover:underline disabled:text-gray-400 dark:disabled:text-slate-500 disabled:no-underline disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
    >
      {allOpen ? 'Collapse all' : 'Expand all'}
    </button>
  );
}
