// Shared admin control classes for the setup wizard (Tailwind, admin accent).
// One primary action per step (§11.1); everything else is quieter.

export { inputClass, labelClass, hintClass } from '@/components/events/EventFormLayout';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

export const primaryButton = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-accent-500 px-5 text-sm font-semibold text-gray-950 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export const secondaryButton = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${focusRing}`;

export const textButton = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white ${focusRing}`;

export const iconButton = `inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800 ${focusRing}`;

export const errorText = 'mt-1 text-sm text-red-700 dark:text-red-400';

/** aria-describedby for a field with an optional hint and error. */
export const describedBy = (id: string, { hint, error }: { hint?: boolean; error?: string | null }) =>
  [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
