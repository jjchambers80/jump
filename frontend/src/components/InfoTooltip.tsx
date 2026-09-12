'use client';

import React, { useId, useState } from 'react';

interface InfoTooltipProps {
  /** Accessible name for the trigger, e.g. "Why contrast matters". */
  label: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Small "?" trigger that reveals a tooltip on hover and keyboard focus.
 * Escape closes it. CSS-only positioning, no external library.
 */
export default function InfoTooltip({ label, children, className }: InfoTooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex ${className ?? ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-400 dark:border-slate-500 text-[11px] font-bold leading-none text-gray-600 dark:text-slate-300 hover:border-gray-600 hover:text-gray-900 dark:hover:border-slate-300 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        ?
      </button>
      <span
        role="tooltip"
        id={id}
        hidden={!open}
        className="absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-md border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3 text-xs leading-relaxed text-gray-700 dark:text-slate-200 shadow-lg"
      >
        {children}
      </span>
    </span>
  );
}
