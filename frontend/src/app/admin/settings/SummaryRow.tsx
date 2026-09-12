'use client';

import { ReactNode, RefObject } from 'react';
import { ChevronRightIcon, EllipsisIcon } from './icons';

interface SummaryRowProps {
  /** Accessible name; the visible text is decorative for AT. */
  label: string;
  leading: ReactNode;
  primary: string;
  secondary: string;
  /** Trailing affordance: chevron (navigates to editor) or ellipsis (actions). */
  trailing?: 'chevron' | 'ellipsis';
  buttonRef: RefObject<HTMLButtonElement>;
  onClick: () => void;
}

/**
 * Read-only row inside a Settings card. The whole row is one button that
 * opens the matching edit dialog; focus returns to it on close.
 */
export default function SummaryRow({ label, leading, primary, secondary, trailing = 'chevron', buttonRef, onClick }: SummaryRowProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/40"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-500 dark:text-slate-400">{leading}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{primary}</span>
        <span className="block truncate text-sm text-gray-600 dark:text-slate-400">{secondary}</span>
      </span>
      <span className="shrink-0 text-gray-400 dark:text-slate-500">
        {trailing === 'chevron' ? <ChevronRightIcon /> : <EllipsisIcon />}
      </span>
    </button>
  );
}
